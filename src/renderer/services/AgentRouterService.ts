import type { AdoSprintWorkItem } from './ado';
import type { Session } from '../types';

export interface RoutedWorkItemRequest {
	templateSession: Session;
	packageName: string;
	packagePath: string;
	workItem: AdoSprintWorkItem;
}

export interface RoutedWorkItemPlan {
	worktreePath: string;
	worktreeBranch: string;
	packageRelativePath: string;
	packageCwd: string;
	initialPrompt: string;
}

export interface SpawnRoutedAgentRequest {
	session: Session;
	tabId: string;
	prompt: string;
}

function detectSeparator(value: string): '/' | '\\' {
	return value.includes('\\') ? '\\' : '/';
}

function normalizeForComparison(value: string): string {
	return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function splitPath(value: string): string[] {
	return value.replace(/\\/g, '/').split('/').filter(Boolean);
}

function joinPath(separator: '/' | '\\', ...parts: string[]): string {
	return parts
		.map((part, index) => (index === 0 ? part.replace(/[\\/]+$/, '') : part.replace(/^[\\/]+|[\\/]+$/g, '')))
		.filter(Boolean)
		.join(separator);
}

function parentDir(value: string): string {
	const separator = detectSeparator(value);
	if (separator === '\\') {
		const normalized = value.replace(/\//g, '\\').replace(/\\+$/, '');
		const lastSlash = normalized.lastIndexOf('\\');
		if (lastSlash <= 2) {
			return `${normalized.slice(0, 2)}\\`;
		}
		return normalized.slice(0, lastSlash);
	}

	const normalized = value.replace(/\/+$/, '');
	const lastSlash = normalized.lastIndexOf('/');
	if (lastSlash <= 0) return '/';
	return normalized.slice(0, lastSlash);
}

function basename(value: string): string {
	const parts = splitPath(value);
	return parts.length > 0 ? parts[parts.length - 1] : value;
}

function slugify(value: string, fallback: string): string {
	const cleaned = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return cleaned || fallback;
}

function buildPrompt(packageName: string, packageCwd: string, workItem: AdoSprintWorkItem): string {
	const criteria = workItem.acceptanceCriteria?.trim() || 'No acceptance criteria provided.';
	return [
		`You are working in the ${packageName} microfrontend.`,
		`Your task is to fulfill this ADO Work Item: ${workItem.title}.`,
		`Work Item ID: ${workItem.id}`,
		'Acceptance Criteria:',
		criteria,
		'Only modify files within this package.',
		`Allowed package path: ${packageCwd}`,
	].join('\n');
}

export class AgentRouterService {
	async routeWorkItemToMfe(request: RoutedWorkItemRequest): Promise<RoutedWorkItemPlan> {
		const { templateSession, packageName, packagePath, workItem } = request;
		const sshRemoteId =
			templateSession.sshRemoteId || templateSession.sessionSshRemoteConfig?.remoteId || undefined;

		const repoRootResult = await window.maestro.git.getRepoRoot(templateSession.cwd, sshRemoteId);
		if (!repoRootResult.success || !repoRootResult.root) {
			throw new Error(repoRootResult.error || 'Unable to determine repository root for routing');
		}

		const repoRoot = repoRootResult.root;
		const repoRootNormalized = normalizeForComparison(repoRoot);
		const packagePathNormalized = normalizeForComparison(packagePath);

		if (
			packagePathNormalized !== repoRootNormalized &&
			!packagePathNormalized.startsWith(`${repoRootNormalized}/`)
		) {
			throw new Error(`Package path is outside repository root: ${packagePath}`);
		}

		const packageRelativePath =
			packagePathNormalized === repoRootNormalized
				? ''
				: packagePathNormalized.slice(repoRootNormalized.length + 1);

		const separator = detectSeparator(repoRoot);
		const repoParent = parentDir(repoRoot);
		const repoName = basename(repoRoot);
		const worktreeBaseDir = joinPath(separator, repoParent, `${repoName}-ado-worktrees`);
		const packageSlug = slugify(packageName, 'mfe');
		const titleSlug = slugify(workItem.title, `wi-${workItem.id}`).slice(0, 48);
		const worktreeBranch = `ado/${packageSlug}/wi-${workItem.id}-${titleSlug}`;
		const worktreeFolder = `${packageSlug}-wi-${workItem.id}-${titleSlug}`;
		const worktreePath = joinPath(separator, worktreeBaseDir, worktreeFolder);

		const setupResult = await window.maestro.git.worktreeSetup(
			repoRoot,
			worktreePath,
			worktreeBranch,
			sshRemoteId
		);

		if (!setupResult.success) {
			throw new Error(setupResult.error || 'Failed to create routed worktree');
		}

		if (setupResult.branchMismatch) {
			const checkoutResult = await window.maestro.git.worktreeCheckout(
				worktreePath,
				worktreeBranch,
				true,
				sshRemoteId
			);
			if (!checkoutResult.success) {
				throw new Error(checkoutResult.error || 'Failed to checkout routed worktree branch');
			}
		}

		const packageCwd = packageRelativePath
			? joinPath(separator, worktreePath, packageRelativePath)
			: worktreePath;

		return {
			worktreePath,
			worktreeBranch,
			packageRelativePath,
			packageCwd,
			initialPrompt: buildPrompt(packageName, packageCwd, workItem),
		};
	}

	async spawnRoutedAgent(request: SpawnRoutedAgentRequest): Promise<void> {
		const { session, tabId, prompt } = request;
		const agent = await window.maestro.agents.get(session.toolType);
		if (!agent || !agent.available) {
			throw new Error(`Assigned agent is unavailable: ${session.toolType}`);
		}

		const spawnSessionId = `${session.id}-ai-${tabId}`;
		const commandToUse = agent.path || agent.command;

		await window.maestro.process.spawn({
			sessionId: spawnSessionId,
			toolType: session.toolType,
			cwd: session.cwd,
			command: commandToUse,
			args: [...(agent.args || [])],
			prompt,
			sessionCustomPath: session.customPath,
			sessionCustomArgs: session.customArgs,
			sessionCustomEnvVars: session.customEnvVars,
			sessionCustomModel: session.customModel,
			sessionCustomContextWindow: session.customContextWindow,
			sessionSshRemoteConfig: session.sessionSshRemoteConfig,
		});
	}
}

export const agentRouterService = new AgentRouterService();
