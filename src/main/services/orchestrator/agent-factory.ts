import type { GroomingProcessManager } from '../../utils/context-groomer';
import { AuditorAgent } from './auditor-agent';

interface AgentFactoryConfig {
	processManager: GroomingProcessManager;
	reportRoot: string;
}

export class AgentFactory {
	private readonly processManager: GroomingProcessManager;
	private readonly reportRoot: string;

	constructor(config: AgentFactoryConfig) {
		this.processManager = config.processManager;
		this.reportRoot = config.reportRoot;
	}

	create(name: string): AuditorAgent {
		return new AuditorAgent({
			processManager: this.processManager,
			agentInstanceId: `${name}-${Date.now()}`,
			reportRoot: this.reportRoot,
			name,
		});
	}
}
