import type { ToolType } from './types';

export type MfePackageRole = 'host' | 'remote' | 'shared';
export type SprintTaskComplexity = 'Low' | 'Medium' | 'High';
export type OrchestratorState = 'planning' | 'delegating' | 'ready' | 'error';
export type WorkerActionType = 'reuse' | 'create';
export type WorkerRiskLevel = 'Low' | 'Medium' | 'High';
export type WorkerTerminationDecision = 'auto-approved' | 'review-gate' | 'recorded';
export type TaskAuditVerdict = 'AUDIT_PASS' | 'AUDIT_FAIL';

export interface ManagerAgentProfile {
	name: 'ManagerAgent';
	agentType: ToolType;
	capabilities: ['root-readonly-fs', 'ado-api', 'agent-factory-control'];
	systemPrompt: string;
}

export interface SprintPlanTask {
	id: number;
	title: string;
	description: string;
	acceptanceCriteria: string;
	state: string;
	tags: string[];
	url: string;
	complexity: SprintTaskComplexity;
}

export interface SprintPlanPackage {
	packageKey: string;
	packageName: string;
	packagePath: string;
	role: MfePackageRole;
	tasks: SprintPlanTask[];
}

export interface SprintExecutionPlan {
	generatedAt: number;
	manager: ManagerAgentProfile;
	packages: SprintPlanPackage[];
	unassigned: SprintPlanTask[];
	contextRefreshed?: boolean;
}

export interface GenerateSprintPlanInput {
	monorepoRoot: string;
	managerAgentType?: ToolType;
}

export interface SprintWorkerPlan {
	packageKey: string;
	packageName: string;
	packagePath: string;
	role: MfePackageRole;
	action: WorkerActionType;
	workerSessionId?: string;
	workerName: string;
	workerType: ToolType | 'gemini-cli';
	status: 'busy' | 'idle';
	tasks: SprintPlanTask[];
}

export interface SprintExecutionResult {
	startedAt: number;
	finishedAt: number;
	workers: SprintWorkerPlan[];
}

export interface WorkerExitReport {
	taskId: string;
	filesTouched: string[];
	summary: string;
	riskLevel: WorkerRiskLevel;
	verificationSteps: string;
}

export interface WorkerTerminationState {
	reportPath: string;
	decision: WorkerTerminationDecision;
}

export interface AuditorAgentProfile {
	name: string;
	agentType: ToolType;
	systemPrompt: string;
}

export interface TaskAuditMetadata {
	taskId: string;
	verdict: TaskAuditVerdict;
	findings: string[];
	branch: string;
	generatedAt: number;
}
