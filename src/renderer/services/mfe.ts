import { createIpcMethod } from './ipcWrapper';

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

export const mfeService = {
	scanWorkspace: async (workspaceRoot: string): Promise<MfeScanResult> =>
		createIpcMethod({
			call: () => window.maestro.mfe.scanWorkspace(workspaceRoot),
			errorContext: 'MFE workspace scan',
			rethrow: true,
		}),
	scanForProposals: async (mfePath: string): Promise<MfeProposal[]> =>
		createIpcMethod({
			call: () => window.maestro.mfe.scanForProposals(mfePath),
			errorContext: 'MFE proposal scan',
			rethrow: true,
		}),
};
