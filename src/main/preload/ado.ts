import { ipcRenderer } from 'electron';
import type { AdoSprintWorkItemsResult } from '../services/ado-service';
import type { AdoBoardItem, AdoBoardSnapshot, AdoWorkItemType } from '../services/AdoBoardService';
import type { TaskProfile } from '../../shared/task-routing';
import type {
	GenerateSprintPlanInput,
	SprintExecutionPlan,
	SprintExecutionResult,
	TaskAuditMetadata,
} from '../../shared/orchestrator-types';

export interface AdoApi {
	startPreview: (payload: {
		worktreePath: string;
		mfeName: string;
	}) => Promise<{ success: boolean; port: number; url: string }>;
	stopPreview: (payload: {
		worktreePath: string;
		mfeName: string;
	}) => Promise<{ success: boolean; stopped: boolean }>;
	getPreviewStatus: (payload: {
		worktreePath: string;
		mfeName: string;
	}) => Promise<{ running: boolean; port?: number; url?: string }>;
	getTerminalErrors: (payload: {
		worktreePath: string;
		mfeName: string;
	}) => Promise<{ output: string }>;
	getDevServerLogs: (payload: {
		worktreePath: string;
		mfeName: string;
		lineCount?: number;
	}) => Promise<{
		lines: Array<{ source: 'stdout' | 'stderr'; text: string }>;
	}>;
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
	getBoardSnapshot: (boardName?: string) => Promise<AdoBoardSnapshot>;
	moveItemToColumn: (payload: {
		ticketId: number;
		targetColumn: string;
		boardName?: string;
	}) => Promise<{ id: number; state: string; boardColumn: string }>;
	createWorkItem: (payload: {
		title: string;
		type: AdoWorkItemType;
		description?: string;
		taskProfile?: TaskProfile;
		areaPath?: string;
		boardName?: string;
		acceptanceCriteria?: string;
	}) => Promise<AdoBoardItem>;
	updateWorkItemTaskProfile: (payload: {
		ticketId: number;
		taskProfile: TaskProfile;
	}) => Promise<{ id: number; tags: string[]; taskProfile: TaskProfile }>;
	updateWorkItemAttachedContext: (payload: {
		ticketId: number;
		attachedContextPaths: string[];
	}) => Promise<{ id: number; attachedContextPaths: string[] }>;
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
	generateSprintPlan: (input: GenerateSprintPlanInput) => Promise<SprintExecutionPlan>;
	executeSprintPlan: (plan: SprintExecutionPlan) => Promise<SprintExecutionResult>;
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
	}) => Promise<{
		success: boolean;
		worktreePath: string;
		packageCwd: string;
		worktreeBranch: string;
		processSessionId: string;
	}>;
	captureWorkerUi: (payload: {
		processSessionId: string;
		routeOrComponent: string;
	}) => Promise<{
		success: boolean;
		snapshotPath: string;
		url: string;
		selector: string;
	}>;
	terminateWorkerAgent: (processSessionId: string) => Promise<{ success: boolean; reportPath: string }>;
	auditTask: (payload: { taskId: string; repositoryRoot?: string }) => Promise<TaskAuditMetadata>;
}

export function createAdoApi(): AdoApi {
	return {
		startPreview: (payload) => ipcRenderer.invoke('ado:startPreview', payload),
		stopPreview: (payload) => ipcRenderer.invoke('ado:stopPreview', payload),
		getPreviewStatus: (payload) => ipcRenderer.invoke('ado:getPreviewStatus', payload),
		getTerminalErrors: (payload) => ipcRenderer.invoke('ado:getTerminalErrors', payload),
		getDevServerLogs: (payload) => ipcRenderer.invoke('ado:getDevServerLogs', payload),
		getSettings: () => ipcRenderer.invoke('ado:getSettings'),
		setSettings: (settings) => ipcRenderer.invoke('ado:setSettings', settings),
		getCurrentSprintWorkItems: () => ipcRenderer.invoke('ado:getCurrentSprintWorkItems'),
		getBoardSnapshot: (boardName) => ipcRenderer.invoke('ado:getBoardSnapshot', boardName),
		moveItemToColumn: (payload) => ipcRenderer.invoke('ado:moveItemToColumn', payload),
		createWorkItem: (payload) => ipcRenderer.invoke('ado:createWorkItem', payload),
		updateWorkItemTaskProfile: (payload) =>
			ipcRenderer.invoke('ado:updateWorkItemTaskProfile', payload),
		updateWorkItemAttachedContext: (payload) =>
			ipcRenderer.invoke('ado:updateWorkItemAttachedContext', payload),
		getCurrentSprintDebug: () => ipcRenderer.invoke('ado:getCurrentSprintDebug'),
		generateSprintReview: () => ipcRenderer.invoke('ado:generateSprintReview'),
		generateSprintPlan: (input) => ipcRenderer.invoke('ado:generateSprintPlan', input),
		executeSprintPlan: (plan) => ipcRenderer.invoke('ado:executeSprintPlan', plan),
		runAgentTask: (payload) => ipcRenderer.invoke('ado:runAgentTask', payload),
		captureWorkerUi: (payload) => ipcRenderer.invoke('ado:captureWorkerUi', payload),
		terminateWorkerAgent: (processSessionId) =>
			ipcRenderer.invoke('ado:terminateWorkerAgent', processSessionId),
		auditTask: (payload) => ipcRenderer.invoke('ado:auditTask', payload),
	};
}
