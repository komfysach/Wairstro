import * as fs from 'fs/promises';
import * as path from 'path';
import type { GroomingProcessManager } from '../../utils/context-groomer';

export type ExitRiskLevel = 'Low' | 'Medium' | 'High';

export interface ExitReport {
	taskId: string;
	filesTouched: string[];
	summary: string;
	riskLevel: ExitRiskLevel;
	verificationSteps: string;
}

export interface Agent {
	terminate(): Promise<{ reportPath: string }>;
}

export interface AgentBaseConfig {
	processManager: GroomingProcessManager;
	agentInstanceId: string;
	reportRoot: string;
}

export abstract class AgentBase implements Agent {
	protected readonly processManager: GroomingProcessManager;
	protected readonly agentInstanceId: string;
	private readonly reportRoot: string;

	protected constructor(config: AgentBaseConfig) {
		this.processManager = config.processManager;
		this.agentInstanceId = config.agentInstanceId;
		this.reportRoot = config.reportRoot;
	}

	protected async generateExitReport(report: ExitReport): Promise<string> {
		const reportsDir = path.join(this.reportRoot, '.guru', 'reports');
		await fs.mkdir(reportsDir, { recursive: true });
		const reportPath = path.join(reportsDir, `${report.taskId}.json`);
		await fs.writeFile(reportPath, `${JSON.stringify(report, null, '\t')}\n`, 'utf8');
		return reportPath;
	}

	abstract terminate(): Promise<{ reportPath: string }>;
}
