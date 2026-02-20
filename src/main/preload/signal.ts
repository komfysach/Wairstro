import { ipcRenderer } from 'electron';
import type {
	LockCheckResult,
	SignalAnnouncement,
	SignalState,
} from '../services/signal-service';

export function createSignalApi() {
	return {
		getState: (): Promise<SignalState> => ipcRenderer.invoke('signal:getState'),
		checkLocks: (filePaths: string[]): Promise<LockCheckResult[]> =>
			ipcRenderer.invoke('signal:checkLocks', filePaths),
		acquireLock: (agentId: string, filePath: string): Promise<boolean> =>
			ipcRenderer.invoke('signal:acquireLock', agentId, filePath),
		releaseLock: (agentId: string, filePath: string): Promise<boolean> =>
			ipcRenderer.invoke('signal:releaseLock', agentId, filePath),
		broadcast: (agentId: string, message: string): Promise<SignalAnnouncement | null> =>
			ipcRenderer.invoke('signal:broadcast', agentId, message),
		onStateUpdated: (handler: (state: SignalState) => void): (() => void) => {
			const wrappedHandler = (_event: Electron.IpcRendererEvent, state: SignalState) => handler(state);
			ipcRenderer.on('signal:stateUpdated', wrappedHandler);
			return () => ipcRenderer.removeListener('signal:stateUpdated', wrappedHandler);
		},
	};
}

export type SignalApi = ReturnType<typeof createSignalApi>;
