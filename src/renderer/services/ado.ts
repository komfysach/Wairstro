import { createIpcMethod } from './ipcWrapper';

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
	state: string;
	tags: string[];
	url: string;
}

export interface AdoCurrentSprintResponse {
	iterationId: string;
	iterationName: string;
	items: AdoSprintWorkItem[];
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

	return [
		`You are an expert developer working on the **${mfeConfig.mfeName}** microfrontend.`,
		'**Context:**',
		`- Repo Path: ${mfeConfig.mfePath}`,
		`- Stack: ${stack}`,
		`**Your Mission (ADO Ticket #${task.ticketId}):**`,
		task.adoTitle,
		'**Requirements:**',
		adoDescription,
		adoAcceptanceCriteria,
		'**Constraint:**',
		`Only modify files inside \`${mfeConfig.mfePath}\`. Do not touch the Host or other Remotes unless explicitly necessary for shared types.`,
	].join('\n');
}

export const adoService = {
	getApi: () => {
		const api = window.maestro?.ado;
		if (!api) {
			throw new Error('ADO bridge is unavailable. Restart Maestro to load the latest preload script.');
		}
		return api;
	},

	getSettings: async (): Promise<AdoSettings> =>
		createIpcMethod({
			call: () => adoService.getApi().getSettings(),
			errorContext: 'ADO settings load',
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

	getCurrentSprintDebug: async (): Promise<AdoCurrentSprintDebug> =>
		createIpcMethod({
			call: () => {
				const api = adoService.getApi() as {
					getCurrentSprintDebug?: () => Promise<AdoCurrentSprintDebug>;
				};
				if (typeof api.getCurrentSprintDebug !== 'function') {
					throw new Error(
						'ADO debug API is unavailable in the current preload bridge. Restart Maestro to load the latest build.'
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

	runAgentTask: async (payload: RunAgentTaskPayload): Promise<RunAgentTaskResult> =>
		createIpcMethod({
			call: () => {
				const api = adoService.getApi() as {
					runAgentTask?: (request: RunAgentTaskPayload) => Promise<RunAgentTaskResult>;
				};
				if (typeof api.runAgentTask !== 'function') {
					throw new Error(
						'ADO run task API is unavailable in the current preload bridge. Restart Maestro to load the latest build.'
					);
				}
				return api.runAgentTask(payload);
			},
			errorContext: 'ADO agent task execution',
			rethrow: true,
		}),
};
