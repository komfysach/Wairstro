import { ipcRenderer } from 'electron';

export type MfePackageRole = 'host' | 'remote' | 'shared';

export interface MfePackageInfo {
	name: string;
	role: MfePackageRole;
	rootPath: string;
	configPaths: string[];
	git: {
		branch: string;
		pendingChanges: number;
	};
	detectionReason: string;
}

export interface MfeScanResult {
	rootPath: string;
	packages: MfePackageInfo[];
	summary: {
		hostCount: number;
		remoteCount: number;
		sharedCount: number;
		totalCount: number;
	};
}

export type MfeProposalType = 'Refactor' | 'Bug Fix' | 'Testing' | 'Dependencies';
export type MfeProposalPriority = 'Low' | 'Medium' | 'High';

export interface MfeProposal {
	title: string;
	type: MfeProposalType;
	description: string;
	location: string;
	priority: MfeProposalPriority;
}

export function createMfeApi() {
	return {
		scanWorkspace: (workspaceRoot: string): Promise<MfeScanResult> =>
			ipcRenderer.invoke('mfe:scanWorkspace', workspaceRoot),
		scanForProposals: (mfePath: string): Promise<MfeProposal[]> =>
			ipcRenderer.invoke('mfe:scanForProposals', mfePath),
	};
}

export type MfeApi = ReturnType<typeof createMfeApi>;
