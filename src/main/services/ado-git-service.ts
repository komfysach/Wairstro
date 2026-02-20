import { safeStorage } from 'electron';
import { execFileNoThrow } from '../utils/execFile';

const ADO_ORG_KEY = 'adoOrganizationEncrypted';
const ADO_PROJECT_KEY = 'adoProjectEncrypted';

export interface AdoPrStatus {
	exists: boolean;
	prId?: number;
	prUrl?: string;
	title?: string;
	sourceBranch?: string;
	targetBranch?: string;
}

interface SettingsStoreLike {
	get: (key: string, defaultValue?: unknown) => unknown;
}

interface CreatePrArgs {
	repoPath: string;
	sourceBranch: string;
	targetBranch: string;
	title: string;
	description: string;
	workItemId?: string;
}

interface CompletePrArgs {
	repoPath: string;
	prId: number;
}

interface AdoPrListItem {
	pullRequestId?: number;
	title?: string;
	sourceRefName?: string;
	targetRefName?: string;
	repository?: {
		name?: string;
		webUrl?: string;
	};
	creationDate?: string;
}

function decryptSecret(value: string | undefined): string {
	if (!value) return '';
	if (!safeStorage.isEncryptionAvailable()) return '';
	return safeStorage.decryptString(Buffer.from(value, 'base64'));
}

function trimBranchPrefix(branchName: string): string {
	return branchName.replace(/^refs\/heads\//, '').trim();
}

function parseRepoNameFromRemoteUrl(remoteUrl: string): string | null {
	const trimmed = remoteUrl.trim();
	if (!trimmed) return null;
	const slashSplit = trimmed.split('/');
	const lastSegment = slashSplit[slashSplit.length - 1] || '';
	const sshSegment = lastSegment.includes(':') ? lastSegment.split(':').pop() || '' : lastSegment;
	const normalized = sshSegment.replace(/\.git$/i, '').trim();
	return normalized || null;
}

export class AdoGitService {
	constructor(private readonly settingsStore: SettingsStoreLike) {}

	private getAdoConfig(): { organization: string; project: string; organizationUrl: string } {
		const encryptedOrg = this.settingsStore.get(ADO_ORG_KEY) as string | undefined;
		const encryptedProject = this.settingsStore.get(ADO_PROJECT_KEY) as string | undefined;
		const organization = decryptSecret(encryptedOrg).trim();
		const project = decryptSecret(encryptedProject).trim();

		if (!organization || !project) {
			throw new Error(
				'ADO organization/project are not configured. Open Settings -> Azure DevOps and save both fields.'
			);
		}

		return {
			organization,
			project,
			organizationUrl: `https://dev.azure.com/${encodeURIComponent(organization)}`,
		};
	}

	private async resolveRepositoryName(repoPath: string): Promise<string> {
		const remoteResult = await execFileNoThrow('git', ['remote', 'get-url', 'origin'], repoPath);
		if (remoteResult.exitCode !== 0) {
			throw new Error(`Failed to resolve git remote: ${remoteResult.stderr || 'origin not found'}`);
		}
		const repoName = parseRepoNameFromRemoteUrl(remoteResult.stdout);
		if (!repoName) {
			throw new Error('Unable to determine repository name from git remote origin URL.');
		}
		return repoName;
	}

	async checkCliAuth(): Promise<{ installed: boolean; authenticated: boolean; error?: string }> {
		const versionResult = await execFileNoThrow('az', ['--version']);
		if (versionResult.exitCode !== 0) {
			return { installed: false, authenticated: false, error: versionResult.stderr || 'az not found' };
		}

		const accountResult = await execFileNoThrow('az', ['account', 'show', '--output', 'json']);
		if (accountResult.exitCode !== 0) {
			return {
				installed: true,
				authenticated: false,
				error: accountResult.stderr || 'Not logged in to Azure CLI',
			};
		}

		return { installed: true, authenticated: true };
	}

	async createPr(args: CreatePrArgs): Promise<{ prId?: number; prUrl: string }> {
		const sourceBranch = trimBranchPrefix(args.sourceBranch);
		const targetBranch = trimBranchPrefix(args.targetBranch);
		if (!sourceBranch) throw new Error('Source branch is required');
		if (!targetBranch) throw new Error('Target branch is required');
		if (!args.title.trim()) throw new Error('PR title is required');

		const { project, organizationUrl } = this.getAdoConfig();
		const repository = await this.resolveRepositoryName(args.repoPath);

		const pushResult = await execFileNoThrow(
			'git',
			['push', '--set-upstream', 'origin', sourceBranch],
			args.repoPath
		);
		if (pushResult.exitCode !== 0) {
			throw new Error(`Failed to push branch: ${pushResult.stderr || pushResult.stdout}`);
		}

		const createArgs = [
			'repos',
			'pr',
			'create',
			'--repository',
			repository,
			'--source-branch',
			sourceBranch,
			'--target-branch',
			targetBranch,
			'--title',
			args.title,
			'--description',
			args.description || '',
			'--organization',
			organizationUrl,
			'--project',
			project,
			'--open',
			'--output',
			'json',
		];

		if (args.workItemId?.trim()) {
			createArgs.push('--work-items', args.workItemId.trim());
		}

		const createResult = await execFileNoThrow('az', createArgs, args.repoPath);
		if (createResult.exitCode !== 0) {
			throw new Error(createResult.stderr || createResult.stdout || 'Failed to create PR in Azure DevOps');
		}

		let prId: number | undefined;
		try {
			const parsed = JSON.parse(createResult.stdout) as { pullRequestId?: number };
			if (typeof parsed.pullRequestId === 'number') {
				prId = parsed.pullRequestId;
			}
		} catch {
			// Fall back to status lookup below.
		}

		if (!prId) {
			const status = await this.getPrStatus(args.repoPath, sourceBranch);
			if (!status.exists || !status.prUrl) {
				throw new Error('PR was created but the resulting URL could not be resolved.');
			}
			return { prId: status.prId, prUrl: status.prUrl };
		}

		return {
			prId,
			prUrl: `${organizationUrl}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repository)}/pullrequest/${prId}`,
		};
	}

	async completePr(args: CompletePrArgs): Promise<{ prId: number }> {
		if (!Number.isInteger(args.prId) || args.prId <= 0) {
			throw new Error('A valid PR id is required.');
		}

		const { project, organizationUrl } = this.getAdoConfig();
		const updateArgs = [
			'repos',
			'pr',
			'update',
			'--id',
			String(args.prId),
			'--status',
			'completed',
			'--organization',
			organizationUrl,
			'--project',
			project,
			'--output',
			'json',
		];

		const updateResult = await execFileNoThrow('az', updateArgs, args.repoPath);
		if (updateResult.exitCode !== 0) {
			throw new Error(
				updateResult.stderr || updateResult.stdout || `Failed to complete PR #${args.prId} in Azure DevOps`
			);
		}

		return { prId: args.prId };
	}

	async getPrStatus(repoPath: string, branchName: string): Promise<AdoPrStatus> {
		const sourceBranch = trimBranchPrefix(branchName);
		if (!sourceBranch) {
			return { exists: false };
		}

		const { project, organizationUrl } = this.getAdoConfig();
		const repository = await this.resolveRepositoryName(repoPath);

		const listArgs = [
			'repos',
			'pr',
			'list',
			'--repository',
			repository,
			'--source-branch',
			sourceBranch,
			'--status',
			'active',
			'--organization',
			organizationUrl,
			'--project',
			project,
			'--output',
			'json',
		];

		const listResult = await execFileNoThrow('az', listArgs, repoPath);
		if (listResult.exitCode !== 0) {
			throw new Error(listResult.stderr || listResult.stdout || 'Failed to query PR status');
		}

		let prs: AdoPrListItem[] = [];
		try {
			const parsed = JSON.parse(listResult.stdout) as AdoPrListItem[];
			prs = Array.isArray(parsed) ? parsed : [];
		} catch {
			prs = [];
		}

		if (prs.length === 0) {
			return { exists: false };
		}

		const latest = prs
			.slice()
			.sort((a, b) => {
				const aDate = a.creationDate ? Date.parse(a.creationDate) : 0;
				const bDate = b.creationDate ? Date.parse(b.creationDate) : 0;
				return bDate - aDate;
			})[0];

		const prId = latest.pullRequestId;
		const prUrl =
			typeof prId === 'number'
				? `${organizationUrl}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repository)}/pullrequest/${prId}`
				: undefined;

		return {
			exists: true,
			prId,
			prUrl,
			title: latest.title,
			sourceBranch: latest.sourceRefName ? trimBranchPrefix(latest.sourceRefName) : sourceBranch,
			targetBranch: latest.targetRefName ? trimBranchPrefix(latest.targetRefName) : undefined,
		};
	}
}
