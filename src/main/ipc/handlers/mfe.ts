import { ipcMain } from 'electron';
import path from 'path';
import { withIpcErrorLogging } from '../../utils/ipcHandler';
import { scanMfeWorkspace, scanMfeForProposals } from '../../utils/mfe-scanner';

const LOG_CONTEXT = '[MFE]';

export function registerMfeHandlers(): void {
	ipcMain.handle(
		'mfe:scanWorkspace',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'scanWorkspace' },
			async (workspaceRoot: string) => {
				if (!workspaceRoot || typeof workspaceRoot !== 'string') {
					throw new Error('A valid workspace root path is required');
				}

				return scanMfeWorkspace(path.resolve(workspaceRoot));
			}
		)
	);

	ipcMain.handle(
		'mfe:scanForProposals',
		withIpcErrorLogging(
			{ context: LOG_CONTEXT, operation: 'scanForProposals' },
			async (mfePath: string) => {
				if (!mfePath || typeof mfePath !== 'string') {
					throw new Error('A valid MFE path is required');
				}

				return scanMfeForProposals(path.resolve(mfePath));
			}
		)
	);
}
