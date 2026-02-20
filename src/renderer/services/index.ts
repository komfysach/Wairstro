/**
 * Renderer Services
 *
 * Service modules that wrap IPC calls to the main process.
 * These provide a clean API layer between React components and Electron IPC.
 */

// Git operations service
export { gitService } from './git';
export type { GitStatus, GitDiff, GitNumstat } from './git';

// Process management service
export { processService } from './process';
export type {
	ProcessConfig,
	ProcessDataHandler,
	ProcessExitHandler,
	ProcessSessionIdHandler,
} from './process';

// IPC wrapper utility
export { createIpcMethod } from './ipcWrapper';
export type { IpcMethodOptions } from './ipcWrapper';

// Context grooming service
export { ContextGroomingService, contextGroomingService } from './contextGroomer';
export type { GroomingResult, GroomingConfig } from './contextGroomer';

// Context summarization service
export { ContextSummarizationService, contextSummarizationService } from './contextSummarizer';
export type { SummarizationConfig } from './contextSummarizer';

// Wizard intent parser service
export { parseWizardIntent, suggestsIterateIntent, suggestsNewIntent } from './wizardIntentParser';
export type { WizardIntentResult } from './wizardIntentParser';

// MFE workspace scanner service
export { mfeService } from './mfe';
export type { MfeScanResult, MfePackageInfo, MfePackageRole } from './mfe';

// ADO sprint planning service
export { adoService } from './ado';
export type {
	AdoSettings,
	AdoSprintWorkItem,
	AdoCurrentSprintResponse,
	AdoCurrentSprintDebug,
	CaptureWorkerUiResult,
} from './ado';
export type {
	GenerateSprintPlanInput,
	SprintExecutionPlan,
	SprintExecutionResult,
} from '../../shared/orchestrator-types';

// Signal coordination service
export { signalService } from './signal';
export type { SignalState, SignalAnnouncement, LockCheckResult } from './signal';

// Agent routing service (ADO work item -> isolated worktree + agent run)
export { AgentRouterService, agentRouterService } from './AgentRouterService';
export type {
	RoutedWorkItemRequest,
	RoutedWorkItemPlan,
	SpawnRoutedAgentRequest,
} from './AgentRouterService';
