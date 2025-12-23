/**
 * Context Merge IPC Handlers
 *
 * This module provides IPC handlers for context merging operations,
 * enabling session context transfer and grooming across AI agents.
 *
 * Usage:
 * - window.maestro.context.getStoredSession(agentId, projectRoot, sessionId)
 * - window.maestro.context.createGroomingSession(projectRoot, agentType)
 * - window.maestro.context.sendGroomingPrompt(sessionId, prompt)
 * - window.maestro.context.cleanupGroomingSession(sessionId)
 */

import { ipcMain, BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import {
  withIpcErrorLogging,
  requireDependency,
  CreateHandlerOptions,
} from '../../utils/ipcHandler';
import {
  getSessionStorage,
  type SessionMessagesResult,
} from '../../agent-session-storage';
import type { ProcessManager } from '../../process-manager';
import type { AgentDetector } from '../../agent-detector';

const LOG_CONTEXT = '[ContextMerge]';

/**
 * Helper to create handler options with consistent context
 */
const handlerOpts = (
  operation: string,
  extra?: Partial<CreateHandlerOptions>
): Pick<CreateHandlerOptions, 'context' | 'operation' | 'logSuccess'> => ({
  context: LOG_CONTEXT,
  operation,
  logSuccess: false,
  ...extra,
});

/**
 * Dependencies required for context handler registration
 */
export interface ContextHandlerDependencies {
  getMainWindow: () => BrowserWindow | null;
  getProcessManager: () => ProcessManager | null;
  getAgentDetector: () => AgentDetector | null;
}

/**
 * Track grooming sessions for cleanup
 * Maps sessionId -> { processId, startTime }
 */
const activeGroomingSessions = new Map<string, {
  groomerSessionId: string;
  startTime: number;
  cleanup?: () => void;
}>();

/**
 * Default timeout for grooming operations (5 minutes)
 */
const GROOMING_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Register all Context Merge IPC handlers.
 *
 * These handlers support context merging operations:
 * - getStoredSession: Retrieve messages from an agent session storage
 * - createGroomingSession: Create a temporary session for context grooming
 * - sendGroomingPrompt: Send a grooming prompt to a session
 * - cleanupGroomingSession: Clean up a temporary grooming session
 */
export function registerContextHandlers(deps: ContextHandlerDependencies): void {
  const { getProcessManager, getAgentDetector } = deps;

  // Get context from a stored agent session
  ipcMain.handle(
    'context:getStoredSession',
    withIpcErrorLogging(
      handlerOpts('getStoredSession'),
      async (agentId: string, projectRoot: string, sessionId: string): Promise<SessionMessagesResult | null> => {
        logger.debug('Getting stored session context', LOG_CONTEXT, {
          agentId,
          projectRoot,
          sessionId,
        });

        const storage = getSessionStorage(agentId);
        if (!storage) {
          logger.warn(`No session storage available for agent: ${agentId}`, LOG_CONTEXT);
          return null;
        }

        try {
          const result = await storage.readSessionMessages(projectRoot, sessionId);
          logger.debug('Retrieved session messages', LOG_CONTEXT, {
            agentId,
            sessionId,
            messageCount: result.messages.length,
            total: result.total,
          });
          return result;
        } catch (error) {
          logger.error('Failed to read session messages', LOG_CONTEXT, {
            agentId,
            projectRoot,
            sessionId,
            error: String(error),
          });
          return null;
        }
      }
    )
  );

  // Create a temporary grooming session
  ipcMain.handle(
    'context:createGroomingSession',
    withIpcErrorLogging(
      handlerOpts('createGroomingSession'),
      async (projectRoot: string, agentType: string): Promise<string> => {
        const processManager = requireDependency(getProcessManager, 'Process manager');
        const agentDetector = requireDependency(getAgentDetector, 'Agent detector');

        // Generate unique grooming session ID
        const groomerSessionId = `groomer-${uuidv4()}`;

        logger.info('Creating grooming session', LOG_CONTEXT, {
          groomerSessionId,
          projectRoot,
          agentType,
        });

        // Get agent configuration
        const agent = await agentDetector.getAgent(agentType);
        if (!agent || !agent.available) {
          throw new Error(`Agent ${agentType} is not available`);
        }

        // Build base args for the agent in batch mode (if supported)
        const baseArgs = [...(agent.args || [])];

        // Add batch mode args if the agent supports it
        // For Claude Code, this means using --print --output-format stream-json
        if (agent.capabilities?.supportsBatchMode) {
          // The process manager will handle adding batch mode args
          // We just need to spawn the process with a prompt
        }

        // Spawn the grooming agent process
        const spawnResult = await processManager.spawn({
          sessionId: groomerSessionId,
          toolType: agentType,
          cwd: projectRoot,
          command: agent.command,
          args: baseArgs,
        });

        if (!spawnResult || spawnResult.pid <= 0) {
          throw new Error(`Failed to spawn grooming process for ${agentType}`);
        }

        // Track this grooming session
        activeGroomingSessions.set(groomerSessionId, {
          groomerSessionId,
          startTime: Date.now(),
        });

        // Set up timeout cleanup
        const timeoutId = setTimeout(() => {
          logger.warn('Grooming session timed out', LOG_CONTEXT, { groomerSessionId });
          cleanupGroomingSessionInternal(groomerSessionId, processManager);
        }, GROOMING_TIMEOUT_MS);

        // Store cleanup function
        const groomingSession = activeGroomingSessions.get(groomerSessionId);
        if (groomingSession) {
          groomingSession.cleanup = () => clearTimeout(timeoutId);
        }

        logger.info('Grooming session created', LOG_CONTEXT, {
          groomerSessionId,
          pid: spawnResult.pid,
        });

        return groomerSessionId;
      }
    )
  );

  // Send grooming prompt to a session
  ipcMain.handle(
    'context:sendGroomingPrompt',
    withIpcErrorLogging(
      handlerOpts('sendGroomingPrompt'),
      async (sessionId: string, prompt: string): Promise<string> => {
        const processManager = requireDependency(getProcessManager, 'Process manager');

        logger.debug('Sending grooming prompt', LOG_CONTEXT, {
          sessionId,
          promptLength: prompt.length,
        });

        // Verify this is a valid grooming session
        const groomingSession = activeGroomingSessions.get(sessionId);
        if (!groomingSession) {
          throw new Error(`No active grooming session found: ${sessionId}`);
        }

        // Write the prompt to the process
        const success = processManager.write(sessionId, prompt + '\n');
        if (!success) {
          throw new Error(`Failed to write prompt to grooming session: ${sessionId}`);
        }

        // For batch mode agents, we need to wait for the response
        // The renderer will handle collecting the response via onData events
        // This handler just sends the prompt and returns success

        logger.info('Grooming prompt sent successfully', LOG_CONTEXT, {
          sessionId,
          promptLength: prompt.length,
        });

        // Return session ID for the renderer to track response
        return sessionId;
      }
    )
  );

  // Cleanup grooming session
  ipcMain.handle(
    'context:cleanupGroomingSession',
    withIpcErrorLogging(
      handlerOpts('cleanupGroomingSession'),
      async (sessionId: string): Promise<void> => {
        const processManager = requireDependency(getProcessManager, 'Process manager');

        logger.info('Cleaning up grooming session', LOG_CONTEXT, { sessionId });

        await cleanupGroomingSessionInternal(sessionId, processManager);
      }
    )
  );
}

/**
 * Internal helper to clean up a grooming session
 */
async function cleanupGroomingSessionInternal(
  sessionId: string,
  processManager: ProcessManager
): Promise<void> {
  const groomingSession = activeGroomingSessions.get(sessionId);

  if (groomingSession) {
    // Clear timeout if set
    if (groomingSession.cleanup) {
      groomingSession.cleanup();
    }

    // Remove from tracking
    activeGroomingSessions.delete(sessionId);

    logger.debug('Removed grooming session from tracking', LOG_CONTEXT, {
      sessionId,
      durationMs: Date.now() - groomingSession.startTime,
    });
  }

  // Kill the process
  try {
    processManager.kill(sessionId);
    logger.debug('Killed grooming session process', LOG_CONTEXT, { sessionId });
  } catch (error) {
    // Process may have already exited
    logger.debug('Could not kill grooming session (may have already exited)', LOG_CONTEXT, {
      sessionId,
      error: String(error),
    });
  }
}

/**
 * Get the number of active grooming sessions (for debugging/monitoring)
 */
export function getActiveGroomingSessionCount(): number {
  return activeGroomingSessions.size;
}

/**
 * Clean up all active grooming sessions (for graceful shutdown)
 */
export async function cleanupAllGroomingSessions(
  processManager: ProcessManager
): Promise<void> {
  logger.info('Cleaning up all grooming sessions', LOG_CONTEXT, {
    count: activeGroomingSessions.size,
  });

  const sessionIds = Array.from(activeGroomingSessions.keys());
  for (const sessionId of sessionIds) {
    await cleanupGroomingSessionInternal(sessionId, processManager);
  }
}
