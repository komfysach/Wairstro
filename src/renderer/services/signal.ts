import { createIpcMethod } from './ipcWrapper';

export interface SignalAnnouncement {
	agentId: string;
	message: string;
	timestamp: number;
}

export interface SignalState {
	locks: Record<string, string>;
	announcements: SignalAnnouncement[];
}

export interface LockCheckResult {
	filePath: string;
	owner: string | null;
}

export const signalService = {
	getState: async (): Promise<SignalState> =>
		createIpcMethod({
			call: () => window.maestro.signal.getState(),
			errorContext: 'Signal state fetch',
			rethrow: true,
		}),
	checkLocks: async (filePaths: string[]): Promise<LockCheckResult[]> =>
		createIpcMethod({
			call: () => window.maestro.signal.checkLocks(filePaths),
			errorContext: 'Signal lock check',
			rethrow: true,
		}),
	acquireLock: async (agentId: string, filePath: string): Promise<boolean> =>
		createIpcMethod({
			call: () => window.maestro.signal.acquireLock(agentId, filePath),
			errorContext: 'Signal lock acquisition',
			rethrow: true,
		}),
	releaseLock: async (agentId: string, filePath: string): Promise<boolean> =>
		createIpcMethod({
			call: () => window.maestro.signal.releaseLock(agentId, filePath),
			errorContext: 'Signal lock release',
			rethrow: true,
		}),
	broadcast: async (agentId: string, message: string): Promise<SignalAnnouncement | null> =>
		createIpcMethod({
			call: () => window.maestro.signal.broadcast(agentId, message),
			errorContext: 'Signal broadcast',
			rethrow: true,
		}),
	onStateUpdated: (handler: (state: SignalState) => void): (() => void) =>
		window.maestro.signal.onStateUpdated(handler),
};
