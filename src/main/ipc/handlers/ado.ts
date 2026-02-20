import { ipcMain, safeStorage } from 'electron';
import type Store from 'electron-store';
import * as fs from 'fs/promises';
import path from 'path';
import { withIpcErrorLogging } from '../../utils/ipcHandler';
import { AdoService } from '../../services/ado-service';
import { AdoBoardService } from '../../services/AdoBoardService';
import { execGit } from '../../utils/remote-git';
import { scanMfeWorkspace } from '../../utils/mfe-scanner';
import { groomContext } from '../../utils/context-groomer';
import { buildAgentArgs, applyAgentConfigOverrides } from '../../utils/agent-args';
import { wrapSpawnWithSsh } from '../../utils/ssh-spawn-wrapper';
import { createSshRemoteStoreAdapter } from '../../utils/ssh-remote-resolver';
import { OrchestratorService } from '../../services/orchestrator-service';
import { WorkerAgent } from '../../services/orchestrator/worker-agent';
import { VisualRendererService } from '../../services/VisualRendererService';
import { PreviewService } from '../../services/PreviewService';
import { getSignalService } from '../../services/signal-service';
import type { ProcessManager } from '../../process-manager';
import type { AgentDetector } from '../../agents';
import type { SshRemoteConfig, ToolType } from '../../../shared/types';
import type { TaskProfile, RoutedAgentType } from '../../../shared/task-routing';
import { routeAgentForTags } from '../../../shared/task-routing';
import type { SessionsData, MaestroSettings } from './persistence';
import type {
	GenerateSprintPlanInput,
	SprintExecutionPlan,
	SprintExecutionResult,
	TaskAuditMetadata,
} from '../../../shared/orchestrator-types';

const LOG_CONTEXT = '[ADO]';

const ADO_ORG_KEY = 'adoOrganizationEncrypted';
const ADO_PROJECT_KEY = 'adoProjectEncrypted';
const ADO_PAT_KEY = 'adoPatEncrypted';
const ADO_TEAM_KEY = 'adoTeam';
const MAX_DIFF_CHARS_PER_WORKTREE = 100_000;
const DONE_STATES = new Set(['done', 'closed', 'resolved', 'completed']);
const GEMINI_CONTEXT_FILENAME = 'GEMINI.md';
const GEMINI_CONTEXT_TEMPLATE = `# Gemini Session Context

This session is managed by Maestro.

## Constraints
- Work only inside this repository/worktree unless explicitly asked.
- Follow project instructions in AGENTS.md / CLAUDE.md when present.
- Ask before destructive operations.
`;
const MAX_REPAIR_ATTEMPTS = 3;
const REPAIR_POLL_INTERVAL_MS = 3_000;

interface RuntimeSession {
	id: string;
	name: string;
	cwd: string;
	projectRoot?: string;
	state?: string;
	toolType?: ToolType;
	parentSessionId?: string;
	worktreeBranch?: string;
	sessionSshRemoteConfig?: {
		enabled: boolean;
		remoteId: string | null;
		workingDirOverride?: string;
	};
}

interface SprintReviewWorktreeDiff {
	sessionId: string;
	sessionName: string;
	cwd: string;
	repoRoot: string;
	worktreeBranch: string | null;
	sshRemoteId: string | null;
	baseRef: string;
	microfrontend: {
		name: string;
		role: 'host' | 'remote' | 'shared' | 'unknown';
		path: string | null;
	};
	diff: string;
	diffTruncated: boolean;
}

interface SprintReviewResult {
	success: boolean;
	markdown: string;
	generatedAt?: number;
	stats?: {
		worktreeCount: number;
		completedItems: number;
		incompleteItems: number;
		durationMs: number;
	};
	warnings?: string[];
	error?: string;
}

interface RunAgentTaskPayload {
	sessionId: string;
	tabId: string;
	assignedAgent: ToolType | RoutedAgentType;
	templateSession: {
		cwd: string;
		customPath?: string;
		customArgs?: string;
		customEnvVars?: Record<string, string>;
		customModel?: string;
		customContextWindow?: number;
		sessionSshRemoteConfig?: {
			enabled: boolean;
			remoteId: string | null;
			workingDirOverride?: string;
		};
	};
	task: {
		ticketId: number;
		adoTitle: string;
		adoDescription?: string;
		adoAcceptanceCriteria?: string;
		attachedContextPaths?: string[];
		figmaLink?: string;
		figmaNodeName?: string;
		uiTarget?: string;
		tags?: string[];
		prompt: string;
	};
	mfeConfig: {
		mfeName: string;
		mfePath: string;
		stack?: string;
	};
}

interface RunAgentTaskResult {
	success: boolean;
	worktreePath: string;
	packageCwd: string;
	worktreeBranch: string;
	processSessionId: string;
}

function withFigmaDesignProtocol(task: RunAgentTaskPayload['task']): string {
	const basePrompt = task.prompt;
	const figmaLink = task.figmaLink?.trim();
	if (!figmaLink) return basePrompt;

	const figmaNodeName = task.figmaNodeName?.trim();
	const figmaBlock = [
		'',
		'**Figma Context:**',
		`- figma_link: ${figmaLink}`,
		figmaNodeName ? `- verified_node_name: ${figmaNodeName}` : '- verified_node_name: (not provided)',
		'',
		'**DESIGN PROTOCOL (Frontend Expert):**',
		'If a figma_link is provided in the task:',
		'1. Do NOT guess styles.',
		'2. Call `figma_get_node(node_id)` to inspect geometry and hierarchy.',
		'3. Call `figma_get_node_children(node_id)` to inspect nested layout structure.',
		'4. Call `figma_get_css_properties(node_id)` to extract exact hex colors, padding, and font sizes.',
		'5. Call `figma_get_text_content(node_id)` to extract exact copy.',
		'6. Before writing code, explicitly state: `I am aligning implementation to Figma Node: [Name]`.',
		'7. If available, call `figma_render_image(node_id)` for visual diff validation before finalizing.',
	].join('\n');

	if (basePrompt.includes('DESIGN PROTOCOL (Frontend Expert):')) {
		return basePrompt;
	}
	return `${basePrompt}${figmaBlock}`;
}

function withTaskRoutingProtocol(
	basePrompt: string,
	assignedAgent: RunAgentTaskPayload['assignedAgent'],
	tags: string[] | undefined
): string {
	if (!basePrompt.trim()) return basePrompt;
	const routed = routeAgentForTags(tags || []);
	const effective = assignedAgent === 'gemini-cli' || assignedAgent === 'codex' ? assignedAgent : routed;
	if (effective === 'gemini-cli') {
		if (basePrompt.includes('VISUAL CRITIC / FIGMA MCP MODE')) return basePrompt;
		return [
			basePrompt,
			'',
			'VISUAL CRITIC / FIGMA MCP MODE:',
			'- Prioritize implementation fidelity against visual specs.',
			'- Use Figma MCP tools for spacing, typography, color, and component hierarchy checks.',
			'- Include concrete UI verification notes before completion.',
		].join('\n');
	}
	if (basePrompt.includes('STRICT TYPESCRIPT/LOGIC MODE')) return basePrompt;
	return [
		basePrompt,
		'',
		'STRICT TYPESCRIPT/LOGIC MODE:',
		'- Prefer strongly typed, minimal, deterministic changes.',
		'- Validate edge cases and keep behaviorally safe defaults.',
		'- If this task requires visual implementation support, call request_ui_assistance().',
	].join('\n');
}

function withSelfHealingProtocol(basePrompt: string): string {
	if (basePrompt.includes('ERROR HANDLING PROTOCOL:')) return basePrompt;
	return [
		basePrompt,
		'',
		'ERROR HANDLING PROTOCOL:',
		'If you attempt to run or preview the code and suspect a build failure, YOU MUST:',
		'1. Call get_terminal_errors().',
		'2. Parse the output for file paths, line numbers, and TypeScript/Rspack error codes.',
		'3. Use your file editing tools to fix the typo, missing import, or type mismatch.',
		'4. Wait 3 seconds for the hot-reload, then check the errors again.',
	].join('\n');
}

function withAttachedFileContextProtocol(
	basePrompt: string,
	attachedContextPaths: string[] | undefined
): string {
	const paths = (attachedContextPaths || [])
		.map((value) => String(value || '').trim().replace(/\\/g, '/'))
		.filter(Boolean);
	if (paths.length === 0) return basePrompt;
	if (basePrompt.includes('EXPLICITLY LINKED FILE CONTEXT:')) return basePrompt;
	return [
		'EXPLICITLY LINKED FILE CONTEXT:',
		'Before doing anything else, read the contents of these explicitly linked files/folders:',
		...paths.map((filePath) => `- ${filePath}`),
		'',
		basePrompt,
	].join('\n');
}

function withMonorepoFocusHint(basePrompt: string, packageRelativePath: string): string {
	if (basePrompt.includes('MONOREPO OPERATING MODE:')) return basePrompt;
	const focusPath = packageRelativePath || '.';
	return [
		'MONOREPO OPERATING MODE:',
		`You are operating in a monorepo. Your primary focus for this task is the ${focusPath} directory, but you have read/write access to the entire repo.`,
		'',
		basePrompt,
	].join('\n');
}

function slugify(value: string, fallback: string): string {
	const cleaned = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return cleaned || fallback;
}

function normalizeForComparison(value: string): string {
	return path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '');
}

function parseBuildErrorDetails(rawOutput: string): { hasError: boolean; fileHint: string; signature: string } {
	const lines = rawOutput
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) {
		return { hasError: false, fileHint: 'unknown file', signature: '' };
	}

	const lowered = lines.map((line) => line.toLowerCase());
	const hasError = lowered.some(
		(line) =>
			/\b(error|failed|ts\d{4}|rspack)\b/.test(line) &&
			!/\bwarning\b/.test(line)
	);
	if (!hasError) {
		return { hasError: false, fileHint: 'unknown file', signature: '' };
	}

	const fileMatch = lines
		.map((line) =>
			line.match(
				/([A-Za-z]:\\[^\s:]+|\/[^\s:]+|\.{1,2}\/[^\s:]+|[A-Za-z0-9._/-]+\.(?:ts|tsx|js|jsx|mjs|cjs|css|scss|sass))(?:[:(]\d+(?::\d+)?\)?)?/g
			)
		)
		.find((matches) => Array.isArray(matches) && matches.length > 0);
	const fileHint = fileMatch?.[0] || 'unknown file';
	const signature = lines.slice(-8).join('\n');
	return { hasError: true, fileHint, signature };
}

async function ensureGeminiContextFile(worktreeRoot: string): Promise<void> {
	const geminiFilePath = path.join(worktreeRoot, GEMINI_CONTEXT_FILENAME);
	try {
		await fs.access(geminiFilePath);
		return;
	} catch {
		// Missing file - create a basic context file.
	}
	await fs.writeFile(geminiFilePath, GEMINI_CONTEXT_TEMPLATE, 'utf8');
}

function ensureSecureStorageAvailable(): void {
	if (!safeStorage.isEncryptionAvailable()) {
		throw new Error('Secure storage is not available on this system');
	}
}

function encryptSecret(value: string): string {
	if (!value) return '';
	ensureSecureStorageAvailable();
	return safeStorage.encryptString(value).toString('base64');
}

function decryptSecret(value: string | undefined): string {
	if (!value) return '';
	ensureSecureStorageAvailable();
	return safeStorage.decryptString(Buffer.from(value, 'base64'));
}

function getStoredCredentials(settingsStore: Store<MaestroSettings>) {
	const organization = decryptSecret(settingsStore.get(ADO_ORG_KEY) as string | undefined);
	const project = decryptSecret(settingsStore.get(ADO_PROJECT_KEY) as string | undefined);
	const team = String(settingsStore.get(ADO_TEAM_KEY) || '').trim();
	const pat = decryptSecret(settingsStore.get(ADO_PAT_KEY) as string | undefined);
	return { organization, project, team, pat };
}

export interface AdoHandlerDependencies {
	settingsStore: Store<MaestroSettings>;
	sessionsStore: Store<SessionsData>;
	agentConfigsStore: Store<{ configs: Record<string, Record<string, any>> }>;
	getProcessManager: () => ProcessManager | null;
	getAgentDetector: () => AgentDetector | null;
}

export function registerAdoHandlers(deps: AdoHandlerDependencies): void {
	const { settingsStore, sessionsStore, agentConfigsStore, getProcessManager, getAgentDetector } =
		deps;
	const workerAgents = new Map<string, WorkerAgent>();
	const visualRendererService = new VisualRendererService();
	const previewService = new PreviewService();
	let orchestrator: OrchestratorService | null = null;

	const ensureOrchestrator = (): OrchestratorService => {
		if (orchestrator) return orchestrator;
		const processManager = getProcessManager();
		const agentDetector = getAgentDetector();
		if (!processManager || !agentDetector) {
			throw new Error('Background agent services are not initialized yet');
		}
		orchestrator = new OrchestratorService(processManager, agentDetector);
		return orchestrator;
	};

	ipcMain.handle(
		'ado:startPreview',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'startPreview' },
			async (payload: { worktreePath: string; mfeName: string }) => {
				if (!payload?.worktreePath || !payload?.mfeName) {
					throw new Error('worktreePath and mfeName are required.');
				}
				return previewService.startPreview(payload.worktreePath, payload.mfeName);
			}
		)
	);

	ipcMain.handle(
		'ado:stopPreview',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'stopPreview' },
			async (payload: { worktreePath: string; mfeName: string }) => {
				if (!payload?.worktreePath || !payload?.mfeName) {
					throw new Error('worktreePath and mfeName are required.');
				}
				const stopped = await previewService.stopPreview(payload.worktreePath, payload.mfeName);
				return { success: true, stopped };
			}
		)
	);

	ipcMain.handle(
		'ado:getPreviewStatus',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'getPreviewStatus' },
			async (payload: { worktreePath: string; mfeName: string }) => {
				if (!payload?.worktreePath || !payload?.mfeName) {
					throw new Error('worktreePath and mfeName are required.');
				}
				return previewService.getPreviewStatus(payload.worktreePath, payload.mfeName);
			}
		)
	);

	ipcMain.handle(
		'ado:getTerminalErrors',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'getTerminalErrors' },
			async (payload: { worktreePath: string; mfeName: string }) => {
				if (!payload?.worktreePath || !payload?.mfeName) {
					throw new Error('worktreePath and mfeName are required.');
				}
				const output = await previewService.getTerminalErrors(payload.worktreePath, payload.mfeName);
				return { output };
			}
		)
	);

	ipcMain.handle(
		'ado:getDevServerLogs',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'getDevServerLogs' },
			async (payload: { worktreePath: string; mfeName: string; lineCount?: number }) => {
				if (!payload?.worktreePath || !payload?.mfeName) {
					throw new Error('worktreePath and mfeName are required.');
				}
				const lines = await previewService.getDevServerLogs(
					payload.worktreePath,
					payload.mfeName,
					payload.lineCount
				);
				return { lines };
			}
		)
	);

	ipcMain.handle(
		'ado:getSettings',
		withIpcErrorLogging({ context: LOG_CONTEXT, operation: 'getSettings' }, async () => {
			const { organization, project, team, pat } = getStoredCredentials(settingsStore);
			return {
				organization,
				project,
				team,
				hasPat: Boolean(pat),
			};
		})
	);

	ipcMain.handle(
		'ado:setSettings',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'setSettings' },
			async (payload: { organization: string; project: string; team?: string; pat?: string }) => {
				const organization = payload.organization.trim();
				const project = payload.project.trim();
				const team = (payload.team || '').trim();

				if (!organization || !project) {
					throw new Error('Organization and project are required');
				}

				settingsStore.set(ADO_ORG_KEY, encryptSecret(organization) as any);
				settingsStore.set(ADO_PROJECT_KEY, encryptSecret(project) as any);
				settingsStore.set(ADO_TEAM_KEY, team as any);

				if (typeof payload.pat === 'string') {
					settingsStore.set(ADO_PAT_KEY, encryptSecret(payload.pat.trim()) as any);
				}

				const { pat } = getStoredCredentials(settingsStore);
				return { hasPat: Boolean(pat) };
			}
		)
	);

	ipcMain.handle(
		'ado:getCurrentSprintWorkItems',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'getCurrentSprintWorkItems' },
			async () => {
				const { organization, project, team, pat } = getStoredCredentials(settingsStore);
				if (!organization || !project || !pat) {
					throw new Error('ADO credentials are incomplete. Configure organization, project, and PAT.');
				}

				const service = new AdoService({ organization, project, team, pat });
				return service.getCurrentSprintWorkItems();
			}
		)
	);

	ipcMain.handle(
		'ado:getBoardSnapshot',
		withIpcErrorLogging({ context: LOG_CONTEXT, operation: 'getBoardSnapshot' }, async (boardName?: string) => {
			const { organization, project, team, pat } = getStoredCredentials(settingsStore);
			if (!organization || !project || !pat) {
				throw new Error('ADO credentials are incomplete. Configure organization, project, and PAT.');
			}

			const service = new AdoBoardService({ organization, project, team, pat });
			return service.getBoardSnapshot(boardName);
		})
	);

	ipcMain.handle(
		'ado:moveItemToColumn',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'moveItemToColumn' },
			async (payload: { ticketId: number; targetColumn: string; boardName?: string }) => {
				if (!payload || typeof payload.ticketId !== 'number' || !payload.targetColumn) {
					throw new Error('ticketId and targetColumn are required.');
				}
				const { organization, project, team, pat } = getStoredCredentials(settingsStore);
				if (!organization || !project || !pat) {
					throw new Error('ADO credentials are incomplete. Configure organization, project, and PAT.');
				}

				const service = new AdoBoardService({ organization, project, team, pat });
				return service.moveItemToColumn(payload.ticketId, payload.targetColumn, payload.boardName);
			}
		)
	);

	ipcMain.handle(
		'ado:createWorkItem',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'createWorkItem' },
			async (payload: {
				title: string;
				type: 'User Story' | 'Bug' | 'Task';
				description?: string;
				taskProfile?: TaskProfile;
				areaPath?: string;
				boardName?: string;
				acceptanceCriteria?: string;
			}) => {
				if (!payload?.title || !payload?.type) {
					throw new Error('title and type are required.');
				}
				const { organization, project, team, pat } = getStoredCredentials(settingsStore);
				if (!organization || !project || !pat) {
					throw new Error('ADO credentials are incomplete. Configure organization, project, and PAT.');
				}

				const service = new AdoBoardService({ organization, project, team, pat });
				return service.createWorkItem(
					payload.title,
					payload.type,
					payload.description || '',
					payload.taskProfile,
					payload.areaPath,
					payload.boardName,
					payload.acceptanceCriteria
				);
			}
		)
	);

	ipcMain.handle(
		'ado:updateWorkItemTaskProfile',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'updateWorkItemTaskProfile' },
			async (payload: { ticketId: number; taskProfile: TaskProfile }) => {
				if (!payload || typeof payload.ticketId !== 'number' || !payload.taskProfile) {
					throw new Error('ticketId and taskProfile are required.');
				}
				const { organization, project, team, pat } = getStoredCredentials(settingsStore);
				if (!organization || !project || !pat) {
					throw new Error('ADO credentials are incomplete. Configure organization, project, and PAT.');
				}
				const service = new AdoBoardService({ organization, project, team, pat });
				return service.updateWorkItemTaskProfile(payload.ticketId, payload.taskProfile);
			}
		)
	);

	ipcMain.handle(
		'ado:updateWorkItemAttachedContext',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'updateWorkItemAttachedContext' },
			async (payload: { ticketId: number; attachedContextPaths: string[] }) => {
				if (
					!payload ||
					typeof payload.ticketId !== 'number' ||
					!Array.isArray(payload.attachedContextPaths)
				) {
					throw new Error('ticketId and attachedContextPaths are required.');
				}
				const { organization, project, team, pat } = getStoredCredentials(settingsStore);
				if (!organization || !project || !pat) {
					throw new Error('ADO credentials are incomplete. Configure organization, project, and PAT.');
				}
				const service = new AdoBoardService({ organization, project, team, pat });
				return service.updateWorkItemAttachedContext(payload.ticketId, payload.attachedContextPaths);
			}
		)
	);

	ipcMain.handle(
		'ado:getCurrentSprintDebug',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'getCurrentSprintDebug' },
			async () => {
				const { organization, project, team, pat } = getStoredCredentials(settingsStore);
				if (!organization || !project || !pat) {
					throw new Error('ADO credentials are incomplete. Configure organization, project, and PAT.');
				}
				const service = new AdoService({ organization, project, team, pat });
				return service.getCurrentSprintDebug();
			}
		)
	);

	ipcMain.handle(
		'ado:generateSprintPlan',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'generateSprintPlan' },
			async (input: GenerateSprintPlanInput): Promise<SprintExecutionPlan> => {
				if (!input?.monorepoRoot) {
					throw new Error('Monorepo root is required for sprint orchestration.');
				}

				const { organization, project, team, pat } = getStoredCredentials(settingsStore);
				if (!organization || !project || !pat) {
					throw new Error('ADO credentials are incomplete. Configure organization, project, and PAT.');
				}

				const processManager = getProcessManager();
				const agentDetector = getAgentDetector();
				if (!processManager || !agentDetector) {
					throw new Error('Background agent services are not initialized yet');
				}

				const [sprint, scan] = await Promise.all([
					new AdoService({ organization, project, team, pat }).getCurrentSprintWorkItems(),
					scanMfeWorkspace(path.resolve(input.monorepoRoot)),
				]);

				const orchestrator = ensureOrchestrator();
				return orchestrator.generateSprintPlan(
					sprint.items,
					scan.packages.map((pkg) => ({
						name: pkg.name,
						role: pkg.role,
						rootPath: pkg.rootPath,
					})),
					input
				);
			}
		)
	);

	ipcMain.handle(
		'ado:executeSprintPlan',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'executeSprintPlan' },
			async (plan: SprintExecutionPlan): Promise<SprintExecutionResult> => {
				const processManager = getProcessManager();
				const agentDetector = getAgentDetector();
				if (!processManager || !agentDetector) {
					throw new Error('Background agent services are not initialized yet');
				}

				const orchestrator = ensureOrchestrator();
				const sessions = sessionsStore.get('sessions', []) as RuntimeSession[];
				return orchestrator.executeSprintPlan(plan, sessions);
			}
		)
	);

	ipcMain.handle(
		'ado:runAgentTask',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'runAgentTask' },
			async (payload: RunAgentTaskPayload): Promise<RunAgentTaskResult> => {
				if (!payload?.sessionId || !payload?.tabId) {
					throw new Error('Session and tab IDs are required to execute an ADO task.');
				}
				if (!payload.templateSession?.cwd) {
					throw new Error('Template session cwd is required.');
				}
				if (!payload.task?.ticketId || !payload.task?.adoTitle || !payload.task?.prompt) {
					throw new Error('Task payload is incomplete.');
				}
				if (!payload.mfeConfig?.mfePath || !payload.mfeConfig?.mfeName) {
					throw new Error('MFE configuration is incomplete.');
				}

				const processManager = getProcessManager();
				const agentDetector = getAgentDetector();
				if (!processManager || !agentDetector) {
					throw new Error('Background agent services are not initialized yet');
				}

				const sshRemoteId =
					payload.templateSession.sessionSshRemoteConfig?.enabled &&
					payload.templateSession.sessionSshRemoteConfig.remoteId
						? payload.templateSession.sessionSshRemoteConfig.remoteId
						: undefined;
				const sshRemote = sshRemoteId
					? ((settingsStore.get('sshRemotes', []) as SshRemoteConfig[]).find(
							(remote) => remote.id === sshRemoteId && remote.enabled
					  ) ?? null)
					: null;

				const repoRootResult = await execGit(
					['rev-parse', '--show-toplevel'],
					payload.templateSession.cwd,
					sshRemote,
					payload.templateSession.cwd
				);
				if (repoRootResult.exitCode !== 0 || !repoRootResult.stdout.trim()) {
					throw new Error('Unable to determine repository root for the selected agent session.');
				}

				const repoRoot = repoRootResult.stdout.trim();
				const repoRootNormalized = normalizeForComparison(repoRoot);
				const mfePathNormalized = normalizeForComparison(payload.mfeConfig.mfePath);
				if (
					mfePathNormalized !== repoRootNormalized &&
					!mfePathNormalized.startsWith(`${repoRootNormalized}/`)
				) {
					throw new Error(`MFE path is outside the repository root: ${payload.mfeConfig.mfePath}`);
				}

				const packageRelativePath =
					mfePathNormalized === repoRootNormalized
						? ''
						: mfePathNormalized.slice(repoRootNormalized.length + 1);
				const taskPrompt = withMonorepoFocusHint(
					withAttachedFileContextProtocol(
						withSelfHealingProtocol(
							withTaskRoutingProtocol(
								withFigmaDesignProtocol(payload.task),
								payload.assignedAgent,
								payload.task.tags
							)
						),
						payload.task.attachedContextPaths
					),
					packageRelativePath
				);

				const worktreeBaseDir = path.join(repoRoot, '.guru', 'worktrees');
				const branch = `feat/ado-${payload.task.ticketId}`;
				const worktreePath = path.join(worktreeBaseDir, slugify(`feat-ado-${payload.task.ticketId}`, 'feat'));

				const branchExistsResult = await execGit(
					['rev-parse', '--verify', branch],
					repoRoot,
					sshRemote,
					payload.templateSession.cwd
				);
				const setupArgs =
					branchExistsResult.exitCode === 0
						? ['worktree', 'add', worktreePath, branch]
						: ['worktree', 'add', '-b', branch, worktreePath];
				const worktreeSetupResult = await execGit(
					setupArgs,
					repoRoot,
					sshRemote,
					payload.templateSession.cwd
				);
				if (worktreeSetupResult.exitCode !== 0) {
					const existingCheck = await execGit(
						['rev-parse', '--is-inside-work-tree'],
						worktreePath,
						sshRemote,
						payload.templateSession.cwd
					);
					if (existingCheck.exitCode !== 0) {
						throw new Error(worktreeSetupResult.stderr || 'Failed to create ADO worktree.');
					}

					const branchCheck = await execGit(
						['branch', '--show-current'],
						worktreePath,
						sshRemote,
						payload.templateSession.cwd
					);
					if (branchCheck.exitCode !== 0) {
						throw new Error('Failed to inspect existing worktree branch.');
					}
					if (branchCheck.stdout.trim() !== branch) {
						const checkoutResult = await execGit(
							['checkout', branch],
							worktreePath,
							sshRemote,
							payload.templateSession.cwd
						);
						if (checkoutResult.exitCode !== 0) {
							throw new Error(
								checkoutResult.stderr || `Failed to checkout branch ${branch} in worktree.`
							);
						}
					}
				}

				const packageCwd = packageRelativePath
					? path.join(worktreePath, packageRelativePath)
					: worktreePath;
				const agent = await agentDetector.getAgent(payload.assignedAgent);
				if (!agent || !agent.available) {
					throw new Error(`Assigned agent is unavailable: ${payload.assignedAgent}`);
				}

				const commandToUse =
					(payload.templateSession.customPath && payload.templateSession.customPath.trim()) ||
					agent.path ||
					agent.command;
				let spawnArgs = buildAgentArgs(agent, {
					baseArgs: [...(agent.args || [])],
					prompt: taskPrompt,
					cwd: packageCwd,
				});
				const allAgentConfigs = agentConfigsStore.get('configs', {});
				const agentConfigValues = allAgentConfigs[payload.assignedAgent] || {};
				const resolvedOverrides = applyAgentConfigOverrides(agent, spawnArgs, {
					agentConfigValues,
					sessionCustomModel: payload.templateSession.customModel,
					sessionCustomArgs: payload.templateSession.customArgs,
					sessionCustomEnvVars: payload.templateSession.customEnvVars,
				});
				spawnArgs = resolvedOverrides.args;

				let spawnCommand = commandToUse;
				let spawnCwd = worktreePath;
				let spawnPrompt: string | undefined = taskPrompt;
				let spawnEnv = resolvedOverrides.effectiveCustomEnvVars;
				let sshRemoteUsed: SshRemoteConfig | null = null;

				if (payload.templateSession.sessionSshRemoteConfig?.enabled) {
					const wrapped = await wrapSpawnWithSsh(
						{
							command: spawnCommand,
							args: spawnArgs,
							cwd: worktreePath,
							prompt: taskPrompt,
							customEnvVars: spawnEnv,
							promptArgs: agent.promptArgs,
							noPromptSeparator: agent.noPromptSeparator,
							agentBinaryName: agent.binaryName,
						},
						payload.templateSession.sessionSshRemoteConfig,
						createSshRemoteStoreAdapter(settingsStore)
					);
					spawnCommand = wrapped.command;
					spawnArgs = wrapped.args;
					spawnCwd = wrapped.cwd;
					spawnPrompt = wrapped.prompt;
					spawnEnv = wrapped.customEnvVars;
					sshRemoteUsed = wrapped.sshRemoteUsed;
				}

				// Gemini compatibility for ADO routed sessions:
				// run from the package worktree cwd so Gemini workspace tools can access package files.
				// Some Gemini CLI versions do not support --context, so we avoid forcing it.
				if (payload.assignedAgent === ('gemini-cli' as ToolType)) {
					if (!sshRemoteUsed) {
						await ensureGeminiContextFile(worktreePath);
						spawnCwd = worktreePath;
					}
				}

				const processSessionId = `${payload.sessionId}-ai-${payload.tabId}`;
				processManager.spawn({
					sessionId: processSessionId,
					toolType: payload.assignedAgent,
					cwd: spawnCwd,
					command: spawnCommand,
					args: spawnArgs,
					prompt: spawnPrompt,
					requiresPty: sshRemoteUsed ? false : agent.requiresPty,
					customEnvVars: spawnEnv,
					promptArgs: agent.promptArgs,
					noPromptSeparator: agent.noPromptSeparator,
					projectPath: worktreePath,
					sshRemoteId: sshRemoteUsed?.id,
					sshRemoteHost: sshRemoteUsed?.host,
				});

				const workerAgent = new WorkerAgent({
					processManager,
					agentInstanceId: processSessionId,
					reportRoot: worktreePath,
					taskId: `ADO-${payload.task.ticketId}`,
					taskTitle: payload.task.adoTitle,
					packageCwd,
					sshRemote: sshRemoteUsed,
					templateCwd: payload.templateSession.cwd,
					mfeBaseUrl: process.env.E2E_BASE_URL || 'http://localhost:3000',
					visualRendererService,
					agentDetector,
					assignedAgentType: payload.assignedAgent,
					sessionSshRemoteConfig: payload.templateSession.sessionSshRemoteConfig,
					sessionCustomPath: payload.templateSession.customPath,
					sessionCustomArgs: payload.templateSession.customArgs,
					sessionCustomEnvVars: payload.templateSession.customEnvVars,
					riskLevel: 'Medium',
					verificationSteps: 'Task completed by worker agent process; tests not automatically verified.',
				});
				workerAgents.set(processSessionId, workerAgent);

				const signalService = getSignalService();
				let repairAttempts = 0;
				let lastErrorSignature = '';
				const repairMonitor = setInterval(() => {
					void (async () => {
						const currentWorker = workerAgents.get(processSessionId);
						if (!currentWorker || currentWorker.terminated) {
							clearInterval(repairMonitor);
							return;
						}

						const terminalOutput = await previewService.getTerminalErrors(
							packageCwd,
							payload.mfeConfig.mfeName
						);
						const parsed = parseBuildErrorDetails(terminalOutput);
						if (!parsed.hasError) {
							repairAttempts = 0;
							lastErrorSignature = '';
							return;
						}

						if (parsed.signature && parsed.signature === lastErrorSignature) {
							repairAttempts += 1;
						} else {
							repairAttempts = 1;
							lastErrorSignature = parsed.signature;
						}

						if (repairAttempts < MAX_REPAIR_ATTEMPTS) return;

						clearInterval(repairMonitor);
						const stuckMessage = `I am stuck on a compilation error in ${parsed.fileHint}. I tried fixing it 3 times. Please review the terminal logs.`;
						signalService.broadcast(processSessionId, stuckMessage);
						(processManager as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
							'agent-error',
							processSessionId,
							new Error(stuckMessage)
						);
						(processManager as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
							'data',
							processSessionId,
							`\n${stuckMessage}\n`
						);
						processManager.kill(processSessionId);
					})();
				}, REPAIR_POLL_INTERVAL_MS);

				const onExit = async (exitedSessionId: string) => {
					if (exitedSessionId !== processSessionId) return;
					clearInterval(repairMonitor);
					processManager.off('exit', onExit);
					const agent = workerAgents.get(processSessionId);
					if (!agent || agent.terminated) {
						workerAgents.delete(processSessionId);
						return;
					}
					try {
						try {
							await agent.verifyUi(payload.task.uiTarget);
						} catch {
							// Keep worker shutdown/reporting deterministic even when visual QA fails unexpectedly.
						}
						await agent.terminate();
					} finally {
						workerAgents.delete(processSessionId);
					}
				};
				processManager.on('exit', onExit);

				return {
					success: true,
					worktreePath,
					packageCwd,
					worktreeBranch: branch,
					processSessionId,
				};
			}
		)
	);

	ipcMain.handle(
		'ado:captureWorkerUi',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'captureWorkerUi' },
			async (payload: { processSessionId: string; routeOrComponent: string }) => {
				if (!payload?.processSessionId) {
					throw new Error('processSessionId is required.');
				}
				const workerAgent = workerAgents.get(payload.processSessionId);
				if (!workerAgent) {
					throw new Error(`Worker agent not found for process session ${payload.processSessionId}.`);
				}
				const captureTarget = payload.routeOrComponent || '/';
				const result = await workerAgent.captureLocalUi(captureTarget);
				return {
					success: true,
					snapshotPath: result.snapshotPath,
					url: result.url,
					selector: result.selector,
				};
			}
		)
	);

	ipcMain.handle(
		'ado:terminateWorkerAgent',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'terminateWorkerAgent' },
			async (processSessionId: string): Promise<{ success: boolean; reportPath: string }> => {
				if (!processSessionId) {
					throw new Error('processSessionId is required.');
				}
				const agent = workerAgents.get(processSessionId);
				if (!agent) {
					return { success: false, reportPath: '' };
				}
				const result = await agent.terminate();
				workerAgents.delete(processSessionId);
				return { success: true, reportPath: result.reportPath };
			}
		)
	);

	ipcMain.handle(
		'ado:auditTask',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'auditTask' },
			async (payload: { taskId: string; repositoryRoot?: string }): Promise<TaskAuditMetadata> => {
				if (!payload?.taskId) {
					throw new Error('taskId is required.');
				}
				const orchestrator = ensureOrchestrator();
				return orchestrator.auditTask(payload.taskId, payload.repositoryRoot);
			}
		)
	);

	ipcMain.handle(
		'ado:generateSprintReview',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'generateSprintReview' },
			async (): Promise<SprintReviewResult> => {
				const startedAt = Date.now();
				const { organization, project, team, pat } = getStoredCredentials(settingsStore);
				if (!organization || !project || !pat) {
					throw new Error('ADO credentials are incomplete. Configure organization, project, and PAT.');
				}

				const processManager = getProcessManager();
				const agentDetector = getAgentDetector();
				if (!processManager || !agentDetector) {
					throw new Error('Background agent services are not initialized yet');
				}

				const service = new AdoService({ organization, project, team, pat });
				const sprint = await service.getCurrentSprintWorkItems();
				const completedItems = sprint.items.filter((item) => DONE_STATES.has(item.state.toLowerCase()));
				const incompleteItems = sprint.items.filter((item) => !DONE_STATES.has(item.state.toLowerCase()));

				const sessions = (sessionsStore.get('sessions', []) as RuntimeSession[]).filter(
					(session) => Boolean(session.parentSessionId && session.cwd)
				);
				const uniqueSessions = new Map<string, RuntimeSession>();
				for (const session of sessions) {
					const key = `${session.sessionSshRemoteConfig?.remoteId || 'local'}::${session.cwd}`;
					if (!uniqueSessions.has(key)) {
						uniqueSessions.set(key, session);
					}
				}

				const warnings: string[] = [];
				const diffs: SprintReviewWorktreeDiff[] = [];

				for (const session of uniqueSessions.values()) {
					const sshRemoteId =
						session.sessionSshRemoteConfig?.enabled &&
						session.sessionSshRemoteConfig.remoteId
							? session.sessionSshRemoteConfig.remoteId
							: undefined;
					const sshRemote = sshRemoteId
						? ((settingsStore.get('sshRemotes', []) as SshRemoteConfig[]).find(
								(remote) => remote.id === sshRemoteId && remote.enabled
						  ) ?? null)
						: null;

					const repoRootResult = await execGit(
						['rev-parse', '--show-toplevel'],
						session.cwd,
						sshRemote,
						session.cwd
					);
					if (repoRootResult.exitCode !== 0) {
						warnings.push(`Skipping "${session.name}": unable to resolve repository root.`);
						continue;
					}
					const repoRoot = repoRootResult.stdout.trim();

					let baseRef = 'main';
					const hasMain = await execGit(
						['rev-parse', '--verify', 'main'],
						session.cwd,
						sshRemote,
						session.cwd
					);
					if (hasMain.exitCode !== 0) {
						const hasOriginMain = await execGit(
							['rev-parse', '--verify', 'origin/main'],
							session.cwd,
							sshRemote,
							session.cwd
						);
						if (hasOriginMain.exitCode === 0) {
							baseRef = 'origin/main';
						} else {
							warnings.push(
								`Skipping "${session.name}": neither "main" nor "origin/main" exists in ${repoRoot}.`
							);
							continue;
						}
					}

					const diffResult = await execGit(
						['diff', '--patch', '--no-color', `${baseRef}...HEAD`],
						session.cwd,
						sshRemote,
						session.cwd
					);
					if (diffResult.exitCode !== 0) {
						warnings.push(`Skipping "${session.name}": unable to calculate git diff.`);
						continue;
					}

					const scan = !sshRemote ? await scanMfeWorkspace(repoRoot).catch(() => null) : null;
					const matchedPackage = scan
						? scan.packages
								.filter((pkg) => session.cwd.replace(/\\/g, '/').startsWith(pkg.rootPath.replace(/\\/g, '/')))
								.sort((a, b) => b.rootPath.length - a.rootPath.length)[0]
						: null;

					const trimmedDiff =
						diffResult.stdout.length > MAX_DIFF_CHARS_PER_WORKTREE
							? diffResult.stdout.slice(0, MAX_DIFF_CHARS_PER_WORKTREE)
							: diffResult.stdout;

					diffs.push({
						sessionId: session.id,
						sessionName: session.name,
						cwd: session.cwd,
						repoRoot,
						worktreeBranch: session.worktreeBranch || null,
						sshRemoteId: sshRemoteId || null,
						baseRef,
						microfrontend: {
							name: matchedPackage?.name || session.name,
							role: matchedPackage?.role || 'unknown',
							path: matchedPackage?.rootPath || null,
						},
						diff: trimmedDiff,
						diffTruncated: diffResult.stdout.length > MAX_DIFF_CHARS_PER_WORKTREE,
					});
				}

				if (diffs.length === 0) {
					return {
						success: false,
						markdown: '',
						error:
							'No active worktree sessions with a valid diff against main were found for this sprint.',
						warnings,
					};
				}

				const provider =
					(settingsStore.get('directorNotesSettings.provider') as ToolType | undefined) ||
					'claude-code';
				const prompt = buildSprintReviewPrompt({
					iterationName: sprint.iterationName,
					diffs,
					completedItems,
					incompleteItems,
				});

				const result = await groomContext(
					{
						projectRoot: process.cwd(),
						agentType: provider,
						prompt,
						readOnlyMode: true,
					},
					processManager,
					agentDetector
				);
				const markdown = result.response.trim();
				if (!markdown) {
					throw new Error('Sprint review generation returned an empty response');
				}

				return {
					success: true,
					markdown,
					generatedAt: Date.now(),
					stats: {
						worktreeCount: diffs.length,
						completedItems: completedItems.length,
						incompleteItems: incompleteItems.length,
						durationMs: Date.now() - startedAt,
					},
					warnings,
				};
			}
		)
	);
}

function buildSprintReviewPrompt(input: {
	iterationName: string;
	diffs: SprintReviewWorktreeDiff[];
	completedItems: Array<{
		id: number;
		title: string;
		state: string;
		tags: string[];
	}>;
	incompleteItems: Array<{
		id: number;
		title: string;
		state: string;
		tags: string[];
	}>;
}): string {
	const done = input.completedItems
		.map((item) => `- #${item.id} [${item.state}] ${item.title}${formatTags(item.tags)}`)
		.join('\n');
	const active = input.incompleteItems
		.map((item) => `- #${item.id} [${item.state}] ${item.title}${formatTags(item.tags)}`)
		.join('\n');

	const diffBlocks = input.diffs
		.map((entry, index) => {
			const header = [
				`### Worktree ${index + 1}: ${entry.microfrontend.name}`,
				`- Role: ${entry.microfrontend.role}`,
				`- Session: ${entry.sessionName} (${entry.sessionId})`,
				`- Branch: ${entry.worktreeBranch || 'unknown'}`,
				`- Repo Root: ${entry.repoRoot}`,
				`- Working Dir: ${entry.cwd}`,
				`- Base Ref: ${entry.baseRef}`,
				entry.diffTruncated ? '- Note: Diff truncated for prompt-size safety.' : '',
				'',
				'```diff',
				entry.diff || '# No changes',
				'```',
			]
				.filter(Boolean)
				.join('\n');

			return header;
		})
		.join('\n\n');

	return [
		'You are generating an end-of-sprint engineering review for parallel microfrontend agent work.',
		'',
		'Output requirements:',
		'1. Return Markdown only (no code fences around the full response).',
		'2. Start with title: `# Sprint Changelog`.',
		'3. Add a `## By Microfrontend` section with sub-sections grouped by microfrontend (Host, Remote 1, Remote 2, Shared, etc.).',
		'4. For each microfrontend, summarize technical implementations based on the diffs and connect each implementation to relevant completed ADO items when possible.',
		'5. Add `## Carry-over to Next Sprint` with unfinished ADO items and a concise technical note about likely remaining implementation work.',
		'6. Keep tone factual and concise; avoid marketing language.',
		'',
		`Sprint iteration: ${input.iterationName}`,
		'',
		'## Completed ADO Items',
		done || '- None',
		'',
		'## Incomplete ADO Items',
		active || '- None',
		'',
		'## Aggregated Worktree Diffs',
		diffBlocks,
	].join('\n');
}

function formatTags(tags: string[]): string {
	if (!tags || tags.length === 0) return '';
	return ` (tags: ${tags.join(', ')})`;
}
