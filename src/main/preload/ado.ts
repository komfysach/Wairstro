import { ipcRenderer } from 'electron';
import type { AdoSprintWorkItemsResult } from '../services/ado-service';

export interface AdoApi {
	getSettings: () => Promise<{
		organization: string;
		project: string;
		team: string;
		hasPat: boolean;
	}>;
	setSettings: (settings: {
		organization: string;
		project: string;
		team?: string;
		pat?: string;
	}) => Promise<{ hasPat: boolean }>;
	getCurrentSprintWorkItems: () => Promise<AdoSprintWorkItemsResult>;
	getCurrentSprintDebug: () => Promise<{
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
	}>;
	generateSprintReview: () => Promise<{
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
	}>;
	runAgentTask: (payload: {
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
	}) => Promise<{
		success: boolean;
		worktreePath: string;
		packageCwd: string;
		worktreeBranch: string;
		processSessionId: string;
	}>;
}

export function createAdoApi(): AdoApi {
	return {
		getSettings: () => ipcRenderer.invoke('ado:getSettings'),
		setSettings: (settings) => ipcRenderer.invoke('ado:setSettings', settings),
		getCurrentSprintWorkItems: () => ipcRenderer.invoke('ado:getCurrentSprintWorkItems'),
		getCurrentSprintDebug: () => ipcRenderer.invoke('ado:getCurrentSprintDebug'),
		generateSprintReview: () => ipcRenderer.invoke('ado:generateSprintReview'),
		runAgentTask: (payload) => ipcRenderer.invoke('ado:runAgentTask', payload),
	};
}
