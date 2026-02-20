import * as fs from 'fs/promises';
import path from 'path';
import type { AgentDetector } from '../agents';
import type { GroomingProcessManager } from '../utils/context-groomer';
import { groomContext } from '../utils/context-groomer';
import { execGit } from '../utils/remote-git';
import type { AdoSprintWorkItem } from './ado-service';
import { AgentFactory } from './orchestrator/agent-factory';
import type {
	GenerateSprintPlanInput,
	ManagerAgentProfile,
	SprintExecutionPlan,
	SprintExecutionResult,
	SprintPlanPackage,
	SprintPlanTask,
	SprintTaskComplexity,
	SprintWorkerPlan,
	TaskAuditMetadata,
	TaskAuditVerdict,
	WorkerExitReport,
	WorkerTerminationState,
} from '../../shared/orchestrator-types';
import type { ToolType } from '../../shared/types';
import { estimateTokenCount } from '../../shared/formatters';
import { routeAgentForTags } from '../../shared/task-routing';

interface MonorepoPackage {
	name: string;
	role: 'host' | 'remote' | 'shared';
	rootPath: string;
}

interface ExistingSession {
	id: string;
	name: string;
	toolType?: ToolType | 'gemini-cli';
	state?: string;
	cwd?: string;
	projectRoot?: string;
	parentSessionId?: string;
}

const MANAGER_SYSTEM_PROMPT =
	'You are the Technical Lead for a microfrontend architecture. Your goal is NOT to write code, but to plan execution.\n' +
	'Input: A list of ADO Work Items and a file map of the monorepo.\n' +
	"Output: A structured JSON 'Execution Plan' that groups tasks by MFE package and estimates complexity.";

const MAX_DESCRIPTION_LEN = 1_500;
const ORCHESTRATOR_CONTEXT_WINDOW_TOKENS = 200_000;
const CONTEXT_DANGER_ZONE_RATIO = 0.8;
const STATE_RESTORE_PREFIX = 'STATE_RESTORE:';

interface OrchestratorChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

function normalizeText(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9/._-]+/g, ' ').trim();
}

function scorePackageMatch(item: AdoSprintWorkItem, pkg: MonorepoPackage): number {
	const haystack = normalizeText(
		[item.title, item.description, item.acceptanceCriteria, item.tags.join(' '), item.url].join(' ')
	);
	const pkgName = normalizeText(pkg.name);
	const pkgPath = normalizeText(pkg.rootPath);
	let score = 0;

	if (pkgName && haystack.includes(pkgName)) score += 4;
	const pkgSegments = pkgPath.split('/').filter((segment) => segment.length >= 3);
	for (const segment of pkgSegments) {
		if (haystack.includes(segment)) score += 2;
	}
	if (pkg.role === 'host' && /(host|shell|container|layout)/.test(haystack)) score += 2;
	if (pkg.role === 'shared' && /(shared|ui library|design system|component kit)/.test(haystack))
		score += 2;
	if (pkg.role === 'remote' && /(remote|microfrontend|mfe|federation)/.test(haystack)) score += 1;

	return score;
}

function estimateComplexity(item: AdoSprintWorkItem): SprintTaskComplexity {
	const signal = normalizeText([item.title, item.description, item.acceptanceCriteria].join(' '));
	const highSignals = ['refactor', 'migration', 'architecture', 'cross-package', 'breaking'];
	const mediumSignals = ['api', 'state', 'integration', 'test', 'error'];

	const highHits = highSignals.filter((token) => signal.includes(token)).length;
	const mediumHits = mediumSignals.filter((token) => signal.includes(token)).length;
	const lengthScore = signal.length > 1_200 ? 2 : signal.length > 500 ? 1 : 0;
	const total = highHits * 2 + mediumHits + lengthScore;

	if (total >= 5) return 'High';
	if (total >= 2) return 'Medium';
	return 'Low';
}

function parseJsonPlan(raw: string): Record<string, Array<{ id: number; complexity?: SprintTaskComplexity }>> | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = fenced ? fenced[1] : trimmed;
	try {
		const parsed = JSON.parse(candidate);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		return parsed as Record<string, Array<{ id: number; complexity?: SprintTaskComplexity }>>;
	} catch {
		return null;
	}
}

function buildManagerPrompt(items: AdoSprintWorkItem[], packages: MonorepoPackage[]): string {
	const packageSummary = packages.map((pkg) => ({
		key: pkg.name,
		path: pkg.rootPath,
		role: pkg.role,
	}));
	const compactItems = items.map((item) => ({
		id: item.id,
		title: item.title,
		description: item.description.slice(0, MAX_DESCRIPTION_LEN),
		acceptanceCriteria: item.acceptanceCriteria.slice(0, MAX_DESCRIPTION_LEN),
		tags: item.tags,
		url: item.url,
	}));

	return [
		`Analyze these ${items.length} work items.`,
		`Based on file paths and descriptions, map each item to one package key from this list: ${packageSummary
			.map((pkg) => pkg.key)
			.join(', ')}.`,
		'Return strict JSON object only. Use this shape:',
		'{"<packageKey>":[{"id":101,"complexity":"Low"}]}',
		'If uncertain, omit the ticket from package arrays.',
		`Packages: ${JSON.stringify(packageSummary)}`,
		`WorkItems: ${JSON.stringify(compactItems)}`,
	].join('\n');
}

function toPlanTask(item: AdoSprintWorkItem, complexity?: SprintTaskComplexity): SprintPlanTask {
	return {
		id: item.id,
		title: item.title,
		description: item.description,
		acceptanceCriteria: item.acceptanceCriteria,
		state: item.state,
		tags: item.tags,
		url: item.url,
		complexity: complexity || estimateComplexity(item),
	};
}

function findWorkerType(existingSessions: ExistingSession[]): ToolType | 'gemini-cli' {
	const preferred = existingSessions.find(
		(session) => session.toolType && session.toolType !== 'terminal'
	);
	return preferred?.toolType || 'codex';
}

export class OrchestratorService {
	private readonly workerTerminationBySessionId = new Map<string, WorkerTerminationState>();
	private readonly taskAuditByTaskId = new Map<string, TaskAuditMetadata>();
	private readonly taskRepoRootByTaskId = new Map<string, string>();
	private chatHistory: OrchestratorChatMessage[] = [];
	private listenerAttached = false;

	constructor(
		private readonly processManager: GroomingProcessManager,
		private readonly agentDetector: AgentDetector
	) {
		this.attachTerminationListener();
	}

	private attachTerminationListener(): void {
		if (this.listenerAttached) return;
		this.listenerAttached = true;

		this.processManager.on('agent:terminated', (...args: unknown[]) => {
			const [sessionId, reportPath] = args;
			if (typeof sessionId !== 'string' || typeof reportPath !== 'string') {
				return;
			}
			void (async () => {
				try {
					const reportRaw = await fs.readFile(reportPath, 'utf8');
					const report = JSON.parse(reportRaw) as WorkerExitReport;
					const decision =
						report.riskLevel === 'Low'
							? 'auto-approved'
							: report.riskLevel === 'High'
								? 'review-gate'
								: 'recorded';
					this.workerTerminationBySessionId.set(sessionId, {
						reportPath,
						decision,
					});
					const repoRoot = path.resolve(path.dirname(reportPath), '..', '..');
					this.taskRepoRootByTaskId.set(report.taskId, repoRoot);
					if (report.riskLevel === 'High') {
						await this.auditTask(report.taskId, repoRoot);
					}
				} catch {
					// Ignore malformed/missing reports; caller can treat as unknown.
				}
			})();
		});
	}

	private detectAuditFindings(diffText: string): string[] {
		const findings: string[] = [];
		const sensitivePatterns: Array<{ regex: RegExp; label: string }> = [
			{ regex: /^\+.*(api[_-]?key|secret|token|password)\s*[:=]/gim, label: 'Potential secret in diff' },
			{ regex: /^\+.*AKIA[0-9A-Z]{16}/gm, label: 'Potential AWS access key leak' },
			{ regex: /^\+.*BEGIN (RSA|EC|OPENSSH) PRIVATE KEY/gm, label: 'Private key material added' },
		];

		for (const pattern of sensitivePatterns) {
			if (pattern.regex.test(diffText)) {
				findings.push(pattern.label);
			}
		}

		if (/^\+\s*console\.log\(/gm.test(diffText)) {
			findings.push('Leftover console.log detected');
		}
		if (/^\+\s*while\s*\(\s*true\s*\)/gm.test(diffText) || /^\+\s*for\s*\(\s*;\s*;\s*\)/gm.test(diffText)) {
			findings.push('Potential infinite loop detected');
		}

		return findings;
	}

	private async writeTaskAuditMetadata(
		repositoryRoot: string,
		taskId: string,
		metadata: TaskAuditMetadata
	): Promise<void> {
		const reportsDir = path.join(repositoryRoot, '.guru', 'reports');
		await fs.mkdir(reportsDir, { recursive: true });
		const metadataPath = path.join(reportsDir, `${taskId}.metadata.json`);
		await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, '\t')}\n`, 'utf8');
	}

	async auditTask(taskId: string, repositoryRoot?: string): Promise<TaskAuditMetadata> {
		const taskRepoRoot = repositoryRoot || this.taskRepoRootByTaskId.get(taskId);
		if (!taskRepoRoot) {
			throw new Error(`Cannot audit task ${taskId}: repository root is unknown.`);
		}

		const agentFactory = new AgentFactory({
			processManager: this.processManager,
			reportRoot: taskRepoRoot,
		});
		const auditor = agentFactory.create(`Auditor-${taskId}`);

		try {
			const branchRef = `feat/task-${taskId}`;
			const diffResult = await execGit(['diff', `main...${branchRef}`], taskRepoRoot);
			const findings =
				diffResult.exitCode === 0
					? this.detectAuditFindings(diffResult.stdout)
					: [`Unable to diff main...${branchRef}: ${diffResult.stderr || 'unknown git error'}`];
			const verdict: TaskAuditVerdict = findings.length === 0 ? 'AUDIT_PASS' : 'AUDIT_FAIL';
			const metadata: TaskAuditMetadata = {
				taskId,
				verdict,
				findings,
				branch: branchRef,
				generatedAt: Date.now(),
			};
			await this.writeTaskAuditMetadata(taskRepoRoot, taskId, metadata);
			this.taskAuditByTaskId.set(taskId, metadata);
			return metadata;
		} finally {
			await auditor.terminate();
		}
	}

	getWorkerTerminationState(sessionId: string): WorkerTerminationState | null {
		return this.workerTerminationBySessionId.get(sessionId) ?? null;
	}

	getTaskAuditMetadata(taskId: string): TaskAuditMetadata | null {
		return this.taskAuditByTaskId.get(taskId) ?? null;
	}

	private serializeConversation(nextUserMessage?: string): string {
		const lines: string[] = [MANAGER_SYSTEM_PROMPT, ''];
		for (const message of this.chatHistory) {
			lines.push(`${message.role.toUpperCase()}: ${message.content}`);
		}
		if (nextUserMessage) {
			lines.push(`USER: ${nextUserMessage}`);
		}
		return lines.join('\n');
	}

	private estimateConversationTokens(nextUserMessage: string): number {
		return estimateTokenCount(this.serializeConversation(nextUserMessage));
	}

	private shouldRefreshContext(nextUserMessage: string): boolean {
		const estimated = this.estimateConversationTokens(nextUserMessage);
		return estimated >= ORCHESTRATOR_CONTEXT_WINDOW_TOKENS * CONTEXT_DANGER_ZONE_RATIO;
	}

	private async condenseContext(projectRoot: string, agentType: ToolType): Promise<void> {
		if (this.chatHistory.length === 0) return;

		const summarizePrompt = [
			'Summarize your current execution plan and active blockers in one concise paragraph.',
			'This summary must be self-contained and ready for restoring state after context reset.',
			'Conversation context:',
			this.serializeConversation(),
		].join('\n\n');

		const summary = await groomContext(
			{
				projectRoot,
				agentType,
				prompt: summarizePrompt,
				readOnlyMode: true,
			},
			this.processManager,
			this.agentDetector
		);

		const normalized = summary.response.replace(/\s+/g, ' ').trim();
		const restoreParagraph =
			normalized.length > 0 ? normalized : 'Current plan and blockers were not available.';

		// Hard reset, then inject STATE_RESTORE as first message after system prompt.
		this.chatHistory = [];
		this.chatHistory.push({
			role: 'assistant',
			content: `${STATE_RESTORE_PREFIX} ${restoreParagraph}`,
		});
	}

	getManagerProfile(agentType: ToolType): ManagerAgentProfile {
		return {
			name: 'ManagerAgent',
			agentType,
			capabilities: ['root-readonly-fs', 'ado-api', 'agent-factory-control'],
			systemPrompt: MANAGER_SYSTEM_PROMPT,
		};
	}

	async generateSprintPlan(
		items: AdoSprintWorkItem[],
		packages: MonorepoPackage[],
		input: GenerateSprintPlanInput
	): Promise<SprintExecutionPlan> {
		if (items.length === 0) {
			return {
				generatedAt: Date.now(),
				manager: this.getManagerProfile(input.managerAgentType || 'claude-code'),
				packages: [],
				unassigned: [],
			};
		}

		const managerAgentType = input.managerAgentType || 'claude-code';
		const currentPrompt = buildManagerPrompt(items, packages);
		let contextRefreshed = false;
		if (this.shouldRefreshContext(currentPrompt)) {
			await this.condenseContext(input.monorepoRoot, managerAgentType);
			contextRefreshed = true;
		}

		const managerPlanPrompt = this.serializeConversation(currentPrompt);
		const managerResponse = await groomContext(
			{
				projectRoot: input.monorepoRoot,
				agentType: managerAgentType,
				prompt: managerPlanPrompt,
				readOnlyMode: true,
			},
			this.processManager,
			this.agentDetector
		);
		this.chatHistory.push({ role: 'user', content: currentPrompt });
		this.chatHistory.push({ role: 'assistant', content: managerResponse.response });
		const parsedPlan = parseJsonPlan(managerResponse.response);

		const itemById = new Map(items.map((item) => [item.id, item]));
		const claimedIds = new Set<number>();
		const resultPackages: SprintPlanPackage[] = [];

		for (const pkg of packages) {
			const planned = parsedPlan?.[pkg.name] || [];
			const plannedTasks = planned
				.map((entry) => itemById.get(entry.id))
				.filter((candidate): candidate is AdoSprintWorkItem => Boolean(candidate))
				.map((item, index) => {
					const complexity = planned[index]?.complexity;
					claimedIds.add(item.id);
					return toPlanTask(item, complexity);
				});
			resultPackages.push({
				packageKey: pkg.name.toLowerCase(),
				packageName: pkg.name,
				packagePath: pkg.rootPath,
				role: pkg.role,
				tasks: plannedTasks,
			});
		}

		for (const item of items) {
			if (claimedIds.has(item.id)) continue;
			let bestPkg: MonorepoPackage | null = null;
			let bestScore = 0;
			for (const pkg of packages) {
				const score = scorePackageMatch(item, pkg);
				if (score > bestScore) {
					bestScore = score;
					bestPkg = pkg;
				}
			}
			if (!bestPkg || bestScore === 0) continue;
			const target = resultPackages.find((pkg) => pkg.packageName === bestPkg.name);
			if (!target) continue;
			target.tasks.push(toPlanTask(item));
			claimedIds.add(item.id);
		}

		const unassigned = items.filter((item) => !claimedIds.has(item.id)).map((item) => toPlanTask(item));

		return {
			generatedAt: Date.now(),
			manager: this.getManagerProfile(managerAgentType),
			packages: resultPackages.filter((pkg) => pkg.tasks.length > 0),
			unassigned,
			contextRefreshed,
		};
	}

	executeSprintPlan(plan: SprintExecutionPlan, existingSessions: ExistingSession[]): SprintExecutionResult {
		const startedAt = Date.now();
		const defaultWorkerType = findWorkerType(existingSessions);
		const workers: SprintWorkerPlan[] = plan.packages.map((pkg) => {
			const taskTags = pkg.tasks.flatMap((task) => task.tags || []);
			const routedWorkerType = routeAgentForTags(taskTags) || defaultWorkerType;
			const reusable = existingSessions.find((session) => {
				if (!session.id || session.parentSessionId) return false;
				if (session.state && session.state !== 'idle') return false;
				if (session.toolType && session.toolType !== routedWorkerType) return false;
				const candidatePath = (session.projectRoot || session.cwd || '').replace(/\\/g, '/');
				const targetPath = pkg.packagePath.replace(/\\/g, '/');
				return candidatePath === targetPath;
			});

			const workerType = routedWorkerType;
			return {
				packageKey: pkg.packageKey,
				packageName: pkg.packageName,
				packagePath: pkg.packagePath,
				role: pkg.role,
				action: reusable ? 'reuse' : 'create',
				workerSessionId: reusable?.id,
				workerName: reusable?.name || `Agent-${pkg.packageName}`,
				workerType,
				status: pkg.tasks.length > 0 ? 'busy' : 'idle',
				tasks: pkg.tasks,
			};
		});

		return {
			startedAt,
			finishedAt: Date.now(),
			workers,
		};
	}
}
