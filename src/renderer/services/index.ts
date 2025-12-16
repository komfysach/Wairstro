/**
 * Renderer Services
 *
 * Service modules that wrap IPC calls to the main process.
 * These provide a clean API layer between React components and Electron IPC.
 */

// Git operations service
export { gitService } from './git';
export type { GitStatus, GitDiff, GitNumstat } from './git';

// Process management service
export { processService } from './process';
export type {
  ProcessConfig,
  ProcessDataHandler,
  ProcessExitHandler,
  ProcessSessionIdHandler,
} from './process';

// IPC wrapper utilities
export {
  createIpcMethod,
  createIpcMethodFactory,
  wrapService,
} from './ipcWrapper';
export type {
  IpcMethodOptionsWithDefault,
  IpcMethodOptionsRethrow,
  IpcMethodOptions,
} from './ipcWrapper';
