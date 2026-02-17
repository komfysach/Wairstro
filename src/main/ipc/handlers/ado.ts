import { ipcMain, safeStorage } from 'electron';
import type Store from 'electron-store';
import * as fs from 'fs/promises';
import path from 'path';
import { withIpcErrorLogging } from '../../utils/ipcHandler';
import { AdoService } from '../../services/ado-service';
import { execGit } from '../../utils/remote-git';
import { scanMfeWorkspace } from '../../utils/mfe-scanner';
import { groomContext } from '../../utils/context-groomer';
import { buildAgentArgs, applyAgentConfigOverrides } from '../../utils/agent-args';
import { wrapSpawnWithSsh } from '../../utils/ssh-spawn-wrapper';
import { createSshRemoteStoreAdapter } from '../../utils/ssh-remote-resolver';
import type { ProcessManager } from '../../process-manager';
import type { AgentDetector } from '../../agents';
import type { SshRemoteConfig, ToolType } from '../../../shared/types';
import type { SessionsData, MaestroSettings } from './persistence';

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

interface RuntimeSession {
	id: string;
	name: string;
	cwd: string;
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
	assignedAgent: ToolType;
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
				const repoParent = path.dirname(repoRoot);
				const repoName = path.basename(repoRoot);
				const worktreeBaseDir = path.join(repoParent, `${repoName}-ado-worktrees`);
				const branch = `feat/ado-${payload.task.ticketId}`;
				const folderSlug = slugify(payload.mfeConfig.mfeName, 'mfe').slice(0, 40);
				const worktreePath = path.join(worktreeBaseDir, `ado-${payload.task.ticketId}-${folderSlug}`);

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
				let worktreeSetupResult = await execGit(
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
					prompt: payload.task.prompt,
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
				let spawnCwd = packageCwd;
				let spawnPrompt: string | undefined = payload.task.prompt;
				let spawnEnv = resolvedOverrides.effectiveCustomEnvVars;
				let sshRemoteUsed: SshRemoteConfig | null = null;

				if (payload.templateSession.sessionSshRemoteConfig?.enabled) {
					const wrapped = await wrapSpawnWithSsh(
						{
							command: spawnCommand,
							args: spawnArgs,
							cwd: packageCwd,
							prompt: payload.task.prompt,
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
						await ensureGeminiContextFile(packageCwd);
						spawnCwd = packageCwd;
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
					projectPath: packageCwd,
					sshRemoteId: sshRemoteUsed?.id,
					sshRemoteHost: sshRemoteUsed?.host,
				});

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
