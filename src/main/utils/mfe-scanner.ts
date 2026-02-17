import fs from 'fs/promises';
import { Dirent } from 'fs';
import path from 'path';
import { execFileNoThrow } from './execFile';

export type MfePackageRole = 'host' | 'remote' | 'shared';

export interface MfePackageGitStatus {
	branch: string;
	pendingChanges: number;
}

export interface MfePackageInfo {
	name: string;
	role: MfePackageRole;
	rootPath: string;
	configPaths: string[];
	git: MfePackageGitStatus;
	detectionReason: string;
}

export interface MfeScanResult {
	rootPath: string;
	packages: MfePackageInfo[];
	summary: {
		hostCount: number;
		remoteCount: number;
		sharedCount: number;
		totalCount: number;
	};
}

export type MfeProposalType = 'Refactor' | 'Bug Fix' | 'Testing' | 'Dependencies';
export type MfeProposalPriority = 'Low' | 'Medium' | 'High';

export interface MfeProposal {
	title: string;
	type: MfeProposalType;
	description: string;
	location: string;
	priority: MfeProposalPriority;
}

const PACKAGES_DIR_NAME = 'packages';
const HOST_PACKAGE_NAME = 'customer-portal';
const SHARED_PACKAGE_NAME = 'shared-ui';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx)$/i;
const SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'dist',
	'build',
	'coverage',
	'.next',
	'out',
	'tmp',
]);
const KNOWN_DEPENDENCY_MINIMUM_MAJOR: Record<string, number> = {
	react: 18,
	'react-dom': 18,
	typescript: 5,
	jest: 29,
	vitest: 1,
	vite: 5,
	webpack: 5,
};
const MAX_PROPOSALS = 20;
const MAX_MISSING_TEST_PROPOSALS = 8;

function getBaseName(value: string): string {
	const normalized = value.trim();
	if (!normalized) return normalized;
	const slashIndex = normalized.lastIndexOf('/');
	return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function inferRole(packageDirName: string, packageNameFromJson: string | null): {
	role: MfePackageRole;
	reason: string;
} {
	const folderName = packageDirName.toLowerCase();
	const packageName = getBaseName(packageNameFromJson || packageDirName).toLowerCase();

	if (folderName === HOST_PACKAGE_NAME || packageName === HOST_PACKAGE_NAME) {
		return {
			role: 'host',
			reason: 'Classified as host by package naming rule (`customer-portal`)',
		};
	}

	if (folderName === SHARED_PACKAGE_NAME || packageName === SHARED_PACKAGE_NAME) {
		return {
			role: 'shared',
			reason: 'Classified as shared library by package naming rule (`shared-ui`)',
		};
	}

	return {
		role: 'remote',
		reason: 'Classified as remote by packages-folder convention',
	};
}

async function readPackageName(packageRoot: string): Promise<string | null> {
	try {
		const raw = await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8');
		const parsed = JSON.parse(raw) as { name?: string };
		return parsed.name || null;
	} catch {
		return null;
	}
}

async function readGitStatus(repoPath: string): Promise<MfePackageGitStatus> {
	const [branchResult, statusResult] = await Promise.all([
		execFileNoThrow('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repoPath),
		execFileNoThrow('git', ['status', '--porcelain'], repoPath),
	]);

	const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : 'N/A';
	const pendingChanges =
		statusResult.exitCode === 0
			? statusResult.stdout
					.split('\n')
					.map((line) => line.trim())
					.filter(Boolean).length
			: 0;

	return { branch, pendingChanges };
}

async function listPackageDirectories(packagesRoot: string): Promise<Dirent[]> {
	try {
		return await fs.readdir(packagesRoot, { withFileTypes: true });
	} catch {
		return [];
	}
}

async function walkFiles(rootPath: string): Promise<string[]> {
	const queue: string[] = [rootPath];
	const files: string[] = [];

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) continue;

		let entries: Dirent[];
		try {
			entries = await fs.readdir(current, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) {
					queue.push(fullPath);
				}
				continue;
			}
			if (entry.isFile()) {
				files.push(fullPath);
			}
		}
	}

	return files;
}

function toRelativePath(rootPath: string, targetPath: string): string {
	return path.relative(rootPath, targetPath).replace(/\\/g, '/');
}

function extractMajorVersion(range: string): number | null {
	const cleaned = range.trim().replace(/^[~^><=\s]*/, '');
	const match = cleaned.match(/^(\d+)(?:\.\d+)?(?:\.\d+)?/);
	if (!match) return null;
	const major = Number(match[1]);
	return Number.isFinite(major) ? major : null;
}

function buildScannerPrompt(mfePath: string): string {
	return [
		'You are the WAIRstro proactive planning scanner.',
		`Scan only this microfrontend path: ${mfePath}`,
		'Find concrete work candidates based on:',
		'- TODO/FIXME comments',
		'- significantly outdated package.json dependencies',
		'- high-complexity files or missing unit tests',
		'Output must be JSON array with: title,type,description,location,priority.',
	].join('\n');
}

async function findTodoAndFixmeProposals(rootPath: string, files: string[]): Promise<MfeProposal[]> {
	const proposals: MfeProposal[] = [];
	const commentPattern = /(TODO|FIXME)\s*[:\-]?\s*(.*)$/i;

	for (const filePath of files) {
		if (!SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) continue;
		let content: string;
		try {
			content = await fs.readFile(filePath, 'utf8');
		} catch {
			continue;
		}

		const lines = content.split('\n');
		for (let index = 0; index < lines.length; index++) {
			const line = lines[index];
			const lineTrim = line.trim();
			if (!lineTrim.includes('TODO') && !lineTrim.includes('FIXME')) continue;
			const match = line.match(commentPattern);
			if (!match) continue;
			const marker = match[1].toUpperCase();
			const detail = (match[2] || '').trim();
			const location = `${toRelativePath(rootPath, filePath)}:${index + 1}`;

			proposals.push({
				title: marker === 'FIXME' ? 'Bug Fix: Resolve FIXME' : 'Refactor: Address TODO',
				type: marker === 'FIXME' ? 'Bug Fix' : 'Refactor',
				description: detail
					? `${marker} found: ${detail}`
					: `${marker} comment found without follow-up implementation.`,
				location,
				priority: marker === 'FIXME' ? 'High' : 'Medium',
			});
		}
	}

	return proposals;
}

async function findDependencyProposals(rootPath: string): Promise<MfeProposal[]> {
	const packageJsonPath = path.join(rootPath, 'package.json');
	let raw: string;
	try {
		raw = await fs.readFile(packageJsonPath, 'utf8');
	} catch {
		return [];
	}

	let parsed: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
	try {
		parsed = JSON.parse(raw) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
	} catch {
		return [];
	}

	const combinedDeps = {
		...(parsed.dependencies || {}),
		...(parsed.devDependencies || {}),
	};
	const proposals: MfeProposal[] = [];

	for (const [name, range] of Object.entries(combinedDeps)) {
		const minimumMajor = KNOWN_DEPENDENCY_MINIMUM_MAJOR[name];
		if (!minimumMajor) continue;
		const currentMajor = extractMajorVersion(range);
		if (currentMajor === null || currentMajor >= minimumMajor) continue;

		proposals.push({
			title: `Dependencies: Upgrade ${name}`,
			type: 'Dependencies',
			description: `${name} is pinned to ${range}, which is behind expected major ${minimumMajor}.`,
			location: 'package.json',
			priority: minimumMajor - currentMajor >= 2 ? 'High' : 'Medium',
		});
	}

	return proposals;
}

function hasSiblingTestFile(filePath: string, allFilesSet: Set<string>): boolean {
	const ext = path.extname(filePath);
	const baseWithoutExt = filePath.slice(0, -ext.length);
	const dirname = path.dirname(filePath);
	const basename = path.basename(filePath, ext);

	const siblingCandidates = [
		`${baseWithoutExt}.test${ext}`,
		`${baseWithoutExt}.spec${ext}`,
		path.join(dirname, '__tests__', `${basename}.test${ext}`),
		path.join(dirname, '__tests__', `${basename}.spec${ext}`),
	];

	return siblingCandidates.some((candidate) => allFilesSet.has(path.resolve(candidate)));
}

async function findComplexityAndTestingProposals(rootPath: string, files: string[]): Promise<MfeProposal[]> {
	const proposals: MfeProposal[] = [];
	const fileSet = new Set(files.map((file) => path.resolve(file)));
	let missingTestCount = 0;

	for (const filePath of files) {
		const ext = path.extname(filePath).toLowerCase();
		if (!SOURCE_EXTENSIONS.has(ext)) continue;
		if (TEST_FILE_PATTERN.test(filePath)) continue;
		if (filePath.endsWith('.d.ts')) continue;

		const relativePath = toRelativePath(rootPath, filePath);
		if (!relativePath.startsWith('src/')) continue;

		let content: string;
		try {
			content = await fs.readFile(filePath, 'utf8');
		} catch {
			continue;
		}

		const lines = content.split('\n');
		const nonEmptyLines = lines.filter((line) => line.trim().length > 0).length;
		const branchLikeCount = (content.match(/\b(if|switch|for|while|catch|\?\s*[^:]+\s*:)\b/g) || []).length;
		const functionLikeCount = (content.match(/\b(function|=>)\b/g) || []).length;
		const complexityScore = branchLikeCount + functionLikeCount;

		if (nonEmptyLines >= 280 || complexityScore >= 45) {
			proposals.push({
				title: 'Refactor: Reduce File Complexity',
				type: 'Refactor',
				description: `${relativePath} is large/complex (${nonEmptyLines} non-empty lines, score ${complexityScore}).`,
				location: relativePath,
				priority: nonEmptyLines >= 420 || complexityScore >= 65 ? 'High' : 'Medium',
			});
		}

		const isComponentFile = ext === '.tsx' || /component|page|view|hook/i.test(path.basename(relativePath));
		if (isComponentFile && !hasSiblingTestFile(filePath, fileSet) && missingTestCount < MAX_MISSING_TEST_PROPOSALS) {
			proposals.push({
				title: 'Testing: Add Unit Test Coverage',
				type: 'Testing',
				description: `No sibling test file found for ${relativePath}. Add basic behavior coverage.`,
				location: relativePath,
				priority: complexityScore >= 35 ? 'High' : 'Medium',
			});
			missingTestCount += 1;
		}
	}

	return proposals;
}

function dedupeAndSortProposals(proposals: MfeProposal[]): MfeProposal[] {
	const seen = new Set<string>();
	const priorityWeight: Record<MfeProposalPriority, number> = { High: 0, Medium: 1, Low: 2 };
	const deduped: MfeProposal[] = [];

	for (const proposal of proposals) {
		const key = `${proposal.type}|${proposal.location}|${proposal.title}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(proposal);
	}

	deduped.sort((a, b) => {
		if (a.priority !== b.priority) return priorityWeight[a.priority] - priorityWeight[b.priority];
		return a.location.localeCompare(b.location);
	});

	return deduped.slice(0, MAX_PROPOSALS);
}

export async function scanMfeForProposals(rootPath: string): Promise<MfeProposal[]> {
	const resolvedRoot = path.resolve(rootPath);
	await fs.access(resolvedRoot);

	// Keep prompt available for traceability as this routine is agent-aligned.
	void buildScannerPrompt(resolvedRoot);

	const files = await walkFiles(resolvedRoot);
	const [todoFixme, dependency, complexityAndTests] = await Promise.all([
		findTodoAndFixmeProposals(resolvedRoot, files),
		findDependencyProposals(resolvedRoot),
		findComplexityAndTestingProposals(resolvedRoot, files),
	]);

	return dedupeAndSortProposals([...todoFixme, ...dependency, ...complexityAndTests]);
}

export async function scanMfeWorkspace(rootPath: string): Promise<MfeScanResult> {
	const resolvedRoot = path.resolve(rootPath);
	const packagesRoot = path.join(resolvedRoot, PACKAGES_DIR_NAME);
	const packageEntries = await listPackageDirectories(packagesRoot);

	const packages = await Promise.all(
		packageEntries
			.filter((entry) => entry.isDirectory())
			.map(async (entry) => {
				const packageRoot = path.join(packagesRoot, entry.name);
				const packageName = await readPackageName(packageRoot);
				const inferred = inferRole(entry.name, packageName);
				const git = await readGitStatus(packageRoot);

				return {
					name: packageName || entry.name,
					role: inferred.role,
					rootPath: packageRoot,
					configPaths: [],
					git,
					detectionReason: inferred.reason,
				} satisfies MfePackageInfo;
			})
	);

	packages.sort((a, b) => {
		if (a.role !== b.role) {
			const weight: Record<MfePackageRole, number> = { host: 0, remote: 1, shared: 2 };
			return weight[a.role] - weight[b.role];
		}
		return a.name.localeCompare(b.name);
	});

	const hostCount = packages.filter((pkg) => pkg.role === 'host').length;
	const remoteCount = packages.filter((pkg) => pkg.role === 'remote').length;
	const sharedCount = packages.filter((pkg) => pkg.role === 'shared').length;

	return {
		rootPath: resolvedRoot,
		packages,
		summary: {
			hostCount,
			remoteCount,
			sharedCount,
			totalCount: packages.length,
		},
	};
}
