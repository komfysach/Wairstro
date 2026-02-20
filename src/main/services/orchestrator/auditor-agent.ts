import { AgentBase, type AgentBaseConfig } from './agent-base';
import type { AuditorAgentProfile } from '../../../shared/orchestrator-types';
import type { ToolType } from '../../../shared/types';

interface AuditorAgentConfig extends AgentBaseConfig {
	name: string;
	agentType?: ToolType;
}

const AUDITOR_SYSTEM_PROMPT =
	'You are a ruthless code reviewer. You have NO memory of previous tasks. Your ONLY job is to read the changes in feat/task-${taskId}, find bugs/security issues, output a verdict, and then cease to exist.';

export class AuditorAgent extends AgentBase {
	private readonly name: string;
	private readonly agentType: ToolType;
	private terminated = false;

	constructor(config: AuditorAgentConfig) {
		super(config);
		this.name = config.name;
		this.agentType = config.agentType || 'codex';
	}

	getProfile(): AuditorAgentProfile {
		return {
			name: this.name,
			agentType: this.agentType,
			systemPrompt: AUDITOR_SYSTEM_PROMPT,
		};
	}

	async terminate(): Promise<{ reportPath: string }> {
		this.terminated = true;
		return { reportPath: '' };
	}

	get isTerminated(): boolean {
		return this.terminated;
	}
}
