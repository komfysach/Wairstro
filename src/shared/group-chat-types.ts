/**
 * @file group-chat-types.ts
 * @description Shared type definitions for Group Chat feature.
 * Used by both main process and renderer.
 */

/**
 * Group chat participant
 */
export interface GroupChatParticipant {
  name: string;
  agentId: string;
  sessionId: string;
  addedAt: number;
  lastActivity?: number;
  lastSummary?: string;
  contextUsage?: number;
}

/**
 * Group chat metadata
 */
export interface GroupChat {
  id: string;
  name: string;
  createdAt: number;
  updatedAt?: number;
  moderatorAgentId: string;
  moderatorSessionId: string;
  participants: GroupChatParticipant[];
  logPath: string;
  imagesDir: string;
}

/**
 * Group chat message entry from the chat log
 */
export interface GroupChatMessage {
  timestamp: string;
  from: string;
  content: string;
}

/**
 * Group chat state for UI display
 */
export type GroupChatState = 'idle' | 'moderator-thinking' | 'agent-working';
