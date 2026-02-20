import { createIpcMethod } from './ipcWrapper';
import type {
	GenerateSprintPlanInput,
	SprintExecutionPlan,
	SprintExecutionResult,
	TaskAuditMetadata,
} from '../../shared/orchestrator-types';
import type { TaskProfile } from '../../shared/task-routing';

export interface AdoSettings {
	organization: string;
	project: string;
	team: string;
	hasPat: boolean;
}

export interface AdoSprintWorkItem {
	id: number;
	title: string;
	description: string;
	acceptanceCriteria: string;
	attachedContextPaths?: string[];
	state: string;
	tags: string[];
	url: string;
}

export interface AdoCurrentSprintResponse {
	iterationId: string;
	iterationName: string;
	items: AdoSprintWorkItem[];
}

export type KanbanLane = 'To-Do' | 'Active' | 'Review' | 'Resolved' | 'Closed';

export interface AdoBoardColumn {
	name: string;
	stateMappings: string[];
	lane: KanbanLane;
}

export interface AdoBoardItem extends AdoSprintWorkItem {
	boardColumn: string;
	lane: KanbanLane;
	taskProfile?: TaskProfile;
}

export type AdoWorkItemType = 'User Story' | 'Bug' | 'Task';

export interface AdoBoardSnapshot {
	boardName: string;
	columns: AdoBoardColumn[];
	items: AdoBoardItem[];
	debug?: {
		resolvedTeam: string | null;
		resolvedBoard: string;
		columnsUrl: string;
		wiqlUrl: string;
		teamFieldValuesUrl?: string;
		wiql: string;
	};
}

export interface AdoCurrentSprintDebug {
	organization: string;
	project: string;
	team: string | null;
	iterationId: string;
	iterationName: string;
	iterationPath: string | null;
	idsFromIterationEndpoint: number[];
	idsFromWiql: number[];
	finalIds: number[];
	itemCount: number;
}

export interface SprintReviewResponse {
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

export interface AgentTaskPromptInput {
	ticketId: number;
	adoTitle: string;
	adoDescription?: string;
	adoAcceptanceCriteria?: string;
	attachedContextPaths?: string[];
	figmaLink?: string;
	figmaNodeName?: string;
	uiTarget?: string;
	tags?: string[];
}

export interface AgentTaskMfeConfig {
	mfeName: string;
	mfePath: string;
	stack?: string;
}

export interface RunAgentTaskPayload {
	sessionId: string;
	tabId: string;
	assignedAgent: string;
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
	task: AgentTaskPromptInput & { prompt: string };
	mfeConfig: AgentTaskMfeConfig;
}

export interface RunAgentTaskResult {
	success: boolean;
	worktreePath: string;
	packageCwd: string;
	worktreeBranch: string;
	processSessionId: string;
}

export interface StartPreviewResult {
	success: boolean;
	port: number;
	url: string;
}

export interface PreviewStatusResult {
	running: boolean;
	port?: number;
	url?: string;
}

export interface DevServerLogLine {
	source: 'stdout' | 'stderr';
	text: string;
}

export interface TerminateWorkerAgentResult {
	success: boolean;
	reportPath: string;
}

export interface CaptureWorkerUiResult {
	success: boolean;
	snapshotPath: string;
	url: string;
	selector: string;
}

function stripHtml(value: string): string {
	return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeRequirementText(value?: string): string {
	const cleaned = stripHtml(value || '');
	return cleaned.length > 0 ? cleaned : '- No additional details provided.';
}

export function buildAgentPayload(task: AgentTaskPromptInput, mfeConfig: AgentTaskMfeConfig): string {
	const stack = mfeConfig.stack || 'Rspack, React, Module Federation';
	const adoDescription = normalizeRequirementText(task.adoDescription);
	const adoAcceptanceCriteria = normalizeRequirementText(task.adoAcceptanceCriteria);
	const figmaLink = task.figmaLink?.trim();
	const figmaNodeName = task.figmaNodeName?.trim();
	const attachedContextPaths = (task.attachedContextPaths || [])
		.map((value) => String(value || '').trim().replace(/\\/g, '/'))
		.filter(Boolean);

	const promptLines = [
		`You are an expert developer working in a monorepo for the **${mfeConfig.mfeName}** microfrontend.`,
		'**Context:**',
		`- Repo Path: ${mfeConfig.mfePath}`,
		`- Stack: ${stack}`,
		`**Your Mission (ADO Ticket #${task.ticketId}):**`,
		task.adoTitle,
		'**Requirements:**',
		adoDescription,
		adoAcceptanceCriteria,
		'MONOREPO OPERATING MODE:',
		`You are operating in a monorepo. Your primary focus for this task is the ${mfeConfig.mfePath} directory, but you have read/write access to the entire repo.`,
		'**COORDINATION RULES:**',
		'1. Check Locks: Before planning any edit, run check_locks(file_list). If a file is locked by another agent, YOU MUST WAIT or choose a different task.',
		'2. Acquire Locks: Once you decide to edit, immediately run acquire_lock(file).',
		"3. Broadcast Breaking Changes: If you modify a shared interface (e.g., API response shape or Props/type definition), run broadcast('Warning: I changed the User type definition').",
		'4. Release: When the task is done, run release_lock(file) for every file you locked.',
		'5. Visual Proof Tool: call capture_local_ui(route_or_component) to capture the exact UI you changed.',
		'   - Route check: capture_local_ui("/orders")',
		'   - Component check: capture_local_ui("::[data-testid=\\"order-table\\"]")',
		'   - Route + selector: capture_local_ui("/orders::[data-testid=\\"order-table\\"]")',
		'   - Output path: .wairstro/snapshots/current_render.png',
		'6. Final Gate: run verify_ui() before marking the ticket done. If it returns VISUAL_MATCH: FALSE, apply fixes and retry (max 3 retries).',
		'',
		'ERROR HANDLING PROTOCOL:',
		'If you attempt to run or preview the code and suspect a build failure, YOU MUST:',
		'1. Call get_terminal_errors().',
		'2. Parse the output for file paths, line numbers, and TypeScript/Rspack error codes.',
		'3. Use your file editing tools to fix the typo, missing import, or type mismatch.',
		'4. Wait 3 seconds for the hot-reload, then check the errors again.',
	];

	if (attachedContextPaths.length > 0) {
		promptLines.unshift(
			'EXPLICITLY LINKED FILE CONTEXT:',
			'Before doing anything else, read the contents of these explicitly linked files/folders:',
			...attachedContextPaths.map((filePath) => `- ${filePath}`),
			''
		);
	}

	if (figmaLink) {
		promptLines.push(
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
			'7. If available, call `figma_render_image(node_id)` for visual diff validation before finalizing.'
		);
	}

	return promptLines.join('\n');
}

export const adoService = {
	getApi: () => {
		const api = window.maestro?.ado;
		if (!api) {
			throw new Error('ADO bridge is unavailable. Restart Guru to load the latest preload script.');
		}
		return api;
	},

	getSettings: async (): Promise<AdoSettings> =>
		createIpcMethod({
			call: () => adoService.getApi().getSettings(),
			errorContext: 'ADO settings load',
			rethrow: true,
		}),

	startPreview: async (payload: {
		worktreePath: string;
		mfeName: string;
	}): Promise<StartPreviewResult> =>
		createIpcMethod({
			call: () => {
				const api = adoService.getApi() as {
					startPreview?: (request: {
						worktreePath: string;
						mfeName: string;
					}) => Promise<StartPreviewResult>;
				};
				if (typeof api.startPreview !== 'function') {
					throw new Error(
						'ADO preview API is unavailable in the current preload bridge. Restart Guru to load the latest build.'
					);
				}
				return api.startPreview(payload);
			},
			errorContext: 'ADO preview server start',
			rethrow: true,
		}),

	stopPreview: async (payload: {
		worktreePath: string;
		mfeName: string;
	}): Promise<{ success: boolean; stopped: boolean }> =>
		createIpcMethod({
			call: () => {
				const api = adoService.getApi() as {
					stopPreview?: (request: {
						worktreePath: string;
						mfeName: string;
					}) => Promise<{ success: boolean; stopped: boolean }>;
				};
				if (typeof api.stopPreview !== 'function') {
					throw new Error(
						'ADO preview stop API is unavailable in the current preload bridge. Restart Guru to load the latest build.'
					);
				}
				return api.stopPreview(payload);
			},
			errorContext: 'ADO preview server stop',
			rethrow: true,
		}),

	getPreviewStatus: async (payload: {
		worktreePath: string;
		mfeName: string;
	}): Promise<PreviewStatusResult> =>
		createIpcMethod({
			call: () => {
				const api = adoService.getApi() as {
					getPreviewStatus?: (request: {
						worktreePath: string;
						mfeName: string;
					}) => Promise<PreviewStatusResult>;
				};
				if (typeof api.getPreviewStatus !== 'function') {
					throw new Error(
						'ADO preview status API is unavailable in the current preload bridge. Restart Guru to load the latest build.'
					);
				}
				return api.getPreviewStatus(payload);
			},
			errorContext: 'ADO preview server status',
			rethrow: true,
		}),

	getTerminalErrors: async (payload: {
		worktreePath: string;
		mfeName: string;
	}): Promise<string> =>
		createIpcMethod({
			call: async () => {
				const api = adoService.getApi() as {
					getTerminalErrors?: (request: {
						worktreePath: string;
						mfeName: string;
					}) => Promise<{ output: string }>;
				};
				if (typeof api.getTerminalErrors !== 'function') {
					throw new Error(
						'ADO terminal error API is unavailable in the current preload bridge. Restart Guru to load the latest build.'
					);
				}
				const result = await api.getTerminalErrors(payload);
				return result.output || '';
			},
			errorContext: 'ADO terminal error retrieval',
			rethrow: true,
		}),

	getDevServerLogs: async (payload: {
		worktreePath: string;
		mfeName: string;
		lineCount?: number;
	}): Promise<DevServerLogLine[]> =>
		createIpcMethod({
			call: async () => {
				const api = adoService.getApi() as {
					getDevServerLogs?: (request: {
						worktreePath: string;
						mfeName: string;
						lineCount?: number;
					}) => Promise<{ lines: DevServerLogLine[] }>;
				};
				if (typeof api.getDevServerLogs !== 'function') {
					throw new Error(
						'ADO dev server log API is unavailable in the current preload bridge. Restart Guru to load the latest build.'
					);
				}
				const result = await api.getDevServerLogs(payload);
				return result.lines || [];
			},
			errorContext: 'ADO dev server log retrieval',
			rethrow: true,
		}),

	setSettings: async (settings: {
		organization: string;
		project: string;
		team?: string;
		pat?: string;
	}): Promise<{ hasPat: boolean }> =>
		createIpcMethod({
			call: () => adoService.getApi().setSettings(settings),
			errorContext: 'ADO settings save',
			rethrow: true,
		}),

	getCurrentSprintWorkItems: async (): Promise<AdoCurrentSprintResponse> =>
		createIpcMethod({
			call: () => adoService.getApi().getCurrentSprintWorkItems(),
			errorContext: 'ADO sprint work items fetch',
			rethrow: true,
		}),

	getBoardSnapshot: async (boardName?: string): Promise<AdoBoardSnapshot> =>
		createIpcMethod({
			call: () => {
				const api = adoService.getApi() as {
					getBoardSnapshot?: (board?: string) => Promise<AdoBoardSnapshot>;
				};
				if (typeof api.getBoardSnapshot !== 'function') {
					throw new Error(
						'ADO board API is unavailable in the current preload bridge. Restart Guru to load the latest build.'
					);
				}
				return api.getBoardSnapshot(boardName);
			},
			errorContext: 'ADO board snapshot fetch',
			rethrow: true,
		}),

	moveItemToColumn: async (
		ticketId: number,
		targetColumn: KanbanLane | string,
		boardName?: string
	): Promise<{ id: number; state: string; boardColumn: string }> =>
		createIpcMethod({
			call: () => {
				const api = adoService.getApi() as {
					moveItemToColumn?: (payload: {
						ticketId: number;
						targetColumn: string;
						boardName?: string;
					}) => Promise<{ id: number; state: string; boardColumn: string }>;
				};
				if (typeof api.moveItemToColumn !== 'function') {
					throw new Error(
						'ADO board move API is unavailable in the current preload bridge. Restart Guru to load the latest build.'
					);
				}
				return api.moveItemToColumn({ ticketId, targetColumn: String(targetColumn), boardName });
			},
			errorContext: 'ADO board item move',
			rethrow: true,
		}),

	createWorkItem: async (payload: {
		title: string;
		type: AdoWorkItemType;
		description?: string;
		taskProfile?: TaskProfile;
		areaPath?: string;
		boardName?: string;
		acceptanceCriteria?: string;
	}): Promise<AdoBoardItem> =>
		createIpcMethod({
			call: () => {
				const api = adoService.getApi() as {
					createWorkItem?: (request: {
						title: string;
						type: AdoWorkItemType;
						description?: string;
						taskProfile?: TaskProfile;
						areaPath?: string;
						boardName?: string;
						acceptanceCriteria?: string;
					}) => Promise<AdoBoardItem>;
				};
				if (typeof api.createWorkItem !== 'function') {
					throw new Error(
						'ADO board create API is unavailable in the current preload bridge. Restart Guru to load the latest build.'
					);
				}
				return api.createWorkItem(payload);
			},
			errorContext: 'ADO work item create',
			rethrow: true,
		}),

	updateWorkItemTaskProfile: async (payload: {
		ticketId: number;
		taskProfile: TaskProfile;
	}): Promise<{ id: number; tags: string[]; taskProfile: TaskProfile }> =>
		createIpcMethod({
			call: () => {
				const api = adoService.getApi() as {
					updateWorkItemTaskProfile?: (request: {
						ticketId: number;
						taskProfile: TaskProfile;
					}) => Promise<{ id: number; tags: string[]; taskProfile: TaskProfile }>;
				};
				if (typeof api.updateWorkItemTaskProfile !== 'function') {
					throw new Error(
						'ADO work item profile API is unavailable in the current preload bridge. Restart Guru to load the latest build.'
					);
				}
				return api.updateWorkItemTaskProfile(payload);
			},
			errorContext: 'ADO work item profile update',
			rethrow: true,
		}),

	updateWorkItemAttachedContext: async (payload: {
		ticketId: number;
		attachedContextPaths: string[];
	}): Promise<{ id: number; attachedContextPaths: string[] }> =>
		createIpcMethod({
			call: () => {
				const api = adoService.getApi() as {
					updateWorkItemAttachedContext?: (request: {
						ticketId: number;
						attachedContextPaths: string[];
					}) => Promise<{ id: number; attachedContextPaths: string[] }>;
				};
				if (typeof api.updateWorkItemAttachedContext !== 'function') {
					throw new Error(
						'ADO work item context API is unavailable in the current preload bridge. Restart Guru to load the latest build.'
					);
				}
				return api.updateWorkItemAttachedContext(payload);
			},
			errorContext: 'ADO work item context update',
			rethrow: true,
		}),

	getCurrentSprintDebug: async (): Promise<AdoCurrentSprintDebug> =>
		createIpcMethod({
			call: () => {
				const api = adoService.getApi() as {
					getCurrentSprintDebug?: () => Promise<AdoCurrentSprintDebug>;
				};
				if (typeof api.getCurrentSprintDebug !== 'function') {
					throw new Error(
						'ADO debug API is unavailable in the current preload bridge. Restart Guru to load the latest build.'
					);
				}
				return api.getCurrentSprintDebug();
			},
			errorContext: 'ADO sprint debug fetch',
			rethrow: true,
		}),

	generateSprintReview: async (): Promise<SprintReviewResponse> =>
		createIpcMethod({
			call: () => adoService.getApi().generateSprintReview(),
			errorContext: 'Sprint review generation',
			rethrow: true,
		}),
	generateSprintPlan: async (input: GenerateSprintPlanInput): Promise<SprintExecutionPlan> =>
		createIpcMethod({
			call: () => {
				const api = adoService.getApi() as {
					generateSprintPlan?: (request: GenerateSprintPlanInput) => Promise<SprintExecutionPlan>;
				};
				if (typeof api.generateSprintPlan !== 'function') {
					throw new Error(
						'ADO sprint orchestrator API is unavailable in the current preload bridge. Restart Guru to load the latest build.'
					);
				}
				return api.generateSprintPlan(input);
			},
			errorContext: 'Sprint orchestration planning',
			rethrow: true,
		}),
	executeSprintPlan: async (plan: SprintExecutionPlan): Promise<SprintExecutionResult> =>
		createIpcMethod({
			call: () => {
				const api = adoService.getApi() as {
					executeSprintPlan?: (plan: SprintExecutionPlan) => Promise<SprintExecutionResult>;
				};
				if (typeof api.executeSprintPlan !== 'function') {
					throw new Error(
						'ADO sprint execution API is unavailable in the current preload bridge. Restart Guru to load the latest build.'
					);
				}
				return api.executeSprintPlan(plan);
			},
			errorContext: 'Sprint orchestration execution',
			rethrow: true,
		}),

	runAgentTask: async (payload: RunAgentTaskPayload): Promise<RunAgentTaskResult> =>
		createIpcMethod({
			call: () => {
				const api = adoService.getApi() as {
					runAgentTask?: (request: RunAgentTaskPayload) => Promise<RunAgentTaskResult>;
				};
				if (typeof api.runAgentTask !== 'function') {
					throw new Error(
						'ADO run task API is unavailable in the current preload bridge. Restart Guru to load the latest build.'
					);
				}
				return api.runAgentTask(payload);
			},
			errorContext: 'ADO agent task execution',
			rethrow: true,
		}),
	captureWorkerUi: async (payload: {
		processSessionId: string;
		routeOrComponent: string;
	}): Promise<CaptureWorkerUiResult> =>
		createIpcMethod({
			call: () => {
				const api = adoService.getApi() as {
					captureWorkerUi?: (request: {
						processSessionId: string;
						routeOrComponent: string;
					}) => Promise<CaptureWorkerUiResult>;
				};
				if (typeof api.captureWorkerUi !== 'function') {
					throw new Error(
						'ADO worker UI capture API is unavailable in the current preload bridge. Restart Guru to load the latest build.'
					);
				}
				return api.captureWorkerUi(payload);
			},
			errorContext: 'ADO worker UI capture',
			rethrow: true,
		}),
	terminateWorkerAgent: async (processSessionId: string): Promise<TerminateWorkerAgentResult> =>
		createIpcMethod({
			call: () => {
				const api = adoService.getApi() as {
					terminateWorkerAgent?: (request: string) => Promise<TerminateWorkerAgentResult>;
				};
				if (typeof api.terminateWorkerAgent !== 'function') {
					throw new Error(
						'ADO terminate worker API is unavailable in the current preload bridge. Restart Guru to load the latest build.'
					);
				}
				return api.terminateWorkerAgent(processSessionId);
			},
			errorContext: 'ADO worker termination',
			rethrow: true,
		}),
	auditTask: async (payload: {
		taskId: string;
		repositoryRoot?: string;
	}): Promise<TaskAuditMetadata> =>
		createIpcMethod({
			call: () => {
				const api = adoService.getApi() as {
					auditTask?: (request: {
						taskId: string;
						repositoryRoot?: string;
					}) => Promise<TaskAuditMetadata>;
				};
				if (typeof api.auditTask !== 'function') {
					throw new Error(
						'ADO audit task API is unavailable in the current preload bridge. Restart Guru to load the latest build.'
					);
				}
				return api.auditTask(payload);
			},
			errorContext: 'ADO task audit',
			rethrow: true,
		}),
};
