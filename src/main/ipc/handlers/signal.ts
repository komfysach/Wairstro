import { BrowserWindow, ipcMain } from 'electron';
import { withIpcErrorLogging } from '../../utils/ipcHandler';
import { getSignalService, type SignalState } from '../../services/signal-service';

const LOG_CONTEXT = '[Signal]';

export interface SignalHandlerDependencies {
	getMainWindow: () => BrowserWindow | null;
}

export function registerSignalHandlers(deps: SignalHandlerDependencies): void {
	const signalService = getSignalService();

	signalService.on('updated', (state: SignalState) => {
		const mainWindow = deps.getMainWindow();
		if (!mainWindow || mainWindow.isDestroyed()) return;
		mainWindow.webContents.send('signal:stateUpdated', state);
	});

	ipcMain.handle(
		'signal:getState',
		withIpcErrorLogging({ context: LOG_CONTEXT, operation: 'getState' }, async () =>
			signalService.getState()
		)
	);

	ipcMain.handle(
		'signal:checkLocks',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'checkLocks' },
			async (filePaths: string[]) => {
				if (!Array.isArray(filePaths)) {
					throw new Error('filePaths must be an array of file paths.');
				}
				return signalService.checkLocks(filePaths);
			}
		)
	);

	ipcMain.handle(
		'signal:acquireLock',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'acquireLock' },
			async (agentId: string, filePath: string) => {
				if (!agentId || !filePath) {
					throw new Error('agentId and filePath are required.');
				}
				return signalService.acquireLock(agentId, filePath);
			}
		)
	);

	ipcMain.handle(
		'signal:releaseLock',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'releaseLock' },
			async (agentId: string, filePath: string) => {
				if (!agentId || !filePath) {
					throw new Error('agentId and filePath are required.');
				}
				return signalService.releaseLock(agentId, filePath);
			}
		)
	);

	ipcMain.handle(
		'signal:broadcast',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'broadcast' },
			async (agentId: string, message: string) => {
				if (!agentId || !message) {
					throw new Error('agentId and message are required.');
				}
				return signalService.broadcast(agentId, message);
			}
		)
	);
}
