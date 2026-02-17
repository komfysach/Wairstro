/**
 * Gemini CLI Output Parser
 *
 * Parses Gemini CLI output for Maestro's normalized parser interface.
 * Gemini CLI output format can vary by mode/version, so this parser supports:
 * - JSONL events (best effort mapping to init/text/result/usage/error)
 * - Plain streaming text fallback (line-by-line)
 */

import type { ToolType, AgentError } from '../../shared/types';
import type { AgentOutputParser, ParsedEvent } from './agent-output-parser';
import { getErrorPatterns, matchErrorPattern } from './error-patterns';
import { stripAllAnsiCodes } from '../utils/terminalFilter';

interface GeminiRawMessage {
	type?: string;
	event?: string;
	session_id?: string;
	sessionId?: string;
	sessionID?: string;
	thread_id?: string;
	text?: string;
	message?: string | { content?: string };
	content?: string | { text?: string };
	delta?: string;
	chunk?: string;
	result?: string;
	done?: boolean;
	final?: boolean;
	finish_reason?: string;
	error?: string | { message?: string };
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		cache_read_tokens?: number;
		cache_write_tokens?: number;
	};
	[key: string]: unknown;
}

export class GeminiOutputParser implements AgentOutputParser {
	readonly agentId: ToolType = 'gemini-cli' as ToolType;

	parseJsonLine(line: string): ParsedEvent | null {
		if (!line.trim()) {
			return null;
		}

		try {
			const msg: GeminiRawMessage = JSON.parse(line);
			return this.transformMessage(msg);
		} catch {
			// Plain streaming text fallback for Gemini CLI modes that don't emit JSON.
			return {
				type: 'text',
				text: line,
				isPartial: true,
				raw: line,
			};
		}
	}

	private transformMessage(msg: GeminiRawMessage): ParsedEvent {
		const sessionId = this.extractSessionIdFromRaw(msg);
		const eventType = (msg.type || msg.event || '').toLowerCase();
		const text = this.extractTextFromRaw(msg);

		if (msg.error || eventType === 'error') {
			const errorText =
				typeof msg.error === 'string'
					? msg.error
					: msg.error?.message || text || 'Gemini CLI error';
			return {
				type: 'error',
				text: errorText,
				sessionId,
				raw: msg,
			};
		}

		if (eventType.includes('init') || eventType.includes('start')) {
			return {
				type: 'init',
				sessionId,
				raw: msg,
			};
		}

		const isFinal =
			msg.done === true ||
			msg.final === true ||
			msg.finish_reason === 'stop' ||
			eventType.includes('result') ||
			eventType.includes('final') ||
			eventType.includes('complete') ||
			eventType === 'done';

		if (text) {
			const parsedEvent: ParsedEvent = {
				type: isFinal ? 'result' : 'text',
				text,
				sessionId,
				isPartial: !isFinal,
				raw: msg,
			};

			const usage = this.extractUsageFromRaw(msg);
			if (usage) {
				parsedEvent.usage = usage;
			}

			return parsedEvent;
		}

		const usage = this.extractUsageFromRaw(msg);
		if (usage) {
			return {
				type: 'usage',
				sessionId,
				usage,
				raw: msg,
			};
		}

		if (isFinal) {
			return {
				type: 'result',
				sessionId,
				raw: msg,
			};
		}

		return {
			type: 'system',
			sessionId,
			raw: msg,
		};
	}

	private extractTextFromRaw(msg: GeminiRawMessage): string {
		if (typeof msg.text === 'string') {
			return msg.text;
		}
		if (typeof msg.delta === 'string') {
			return msg.delta;
		}
		if (typeof msg.chunk === 'string') {
			return msg.chunk;
		}
		if (typeof msg.result === 'string') {
			return msg.result;
		}
		if (typeof msg.message === 'string') {
			return msg.message;
		}
		if (msg.message && typeof msg.message === 'object' && typeof msg.message.content === 'string') {
			return msg.message.content;
		}
		if (typeof msg.content === 'string') {
			return msg.content;
		}
		if (msg.content && typeof msg.content === 'object' && typeof msg.content.text === 'string') {
			return msg.content.text;
		}
		return '';
	}

	private extractSessionIdFromRaw(msg: GeminiRawMessage): string | undefined {
		return msg.session_id || msg.sessionId || msg.sessionID || msg.thread_id;
	}

	private extractUsageFromRaw(msg: GeminiRawMessage): ParsedEvent['usage'] | null {
		if (!msg.usage) {
			return null;
		}

		return {
			inputTokens: msg.usage.input_tokens || 0,
			outputTokens: msg.usage.output_tokens || 0,
			cacheReadTokens: msg.usage.cache_read_tokens || 0,
			cacheCreationTokens: msg.usage.cache_write_tokens || 0,
		};
	}

	isResultMessage(event: ParsedEvent): boolean {
		return event.type === 'result';
	}

	extractSessionId(event: ParsedEvent): string | null {
		return event.sessionId || null;
	}

	extractUsage(event: ParsedEvent): ParsedEvent['usage'] | null {
		return event.usage || null;
	}

	extractSlashCommands(_event: ParsedEvent): string[] | null {
		return null;
	}

	detectErrorFromLine(line: string): AgentError | null {
		if (!line.trim()) {
			return null;
		}

		let errorText: string | null = null;

		try {
			const parsed: GeminiRawMessage = JSON.parse(line);
			if (parsed.type === 'error' || parsed.event === 'error' || parsed.error) {
				errorText =
					typeof parsed.error === 'string'
						? parsed.error
						: parsed.error?.message || this.extractTextFromRaw(parsed) || 'Gemini CLI error';
			}
		} catch {
			// For non-JSON output, only match explicit error-looking lines.
			if (/^\s*(error|fatal)\s*[:\-]/i.test(line)) {
				errorText = line;
			}
		}

		if (!errorText) {
			return null;
		}

		const patterns = getErrorPatterns(this.agentId);
		const match = matchErrorPattern(patterns, errorText);
		if (match) {
			return {
				type: match.type,
				message: match.message,
				recoverable: match.recoverable,
				agentId: this.agentId,
				timestamp: Date.now(),
				raw: {
					errorLine: line,
				},
			};
		}

		return {
			type: 'unknown',
			message: errorText,
			recoverable: true,
			agentId: this.agentId,
			timestamp: Date.now(),
			raw: {
				errorLine: line,
			},
		};
	}

	detectErrorFromExit(exitCode: number, stderr: string, stdout: string): AgentError | null {
		if (exitCode === 0) {
			return null;
		}

		const cleanedStderr = stripAllAnsiCodes(stderr || '');
		const cleanedStdout = stripAllAnsiCodes(stdout || '');
		const combined = `${cleanedStderr}\n${cleanedStdout}`;

		const patterns = getErrorPatterns(this.agentId);
		const match = matchErrorPattern(patterns, combined);
		if (match) {
			return {
				type: match.type,
				message: match.message,
				recoverable: match.recoverable,
				agentId: this.agentId,
				timestamp: Date.now(),
				raw: {
					exitCode,
					stderr,
					stdout,
				},
			};
		}

		const stderrPreview = cleanedStderr.trim()
			? `: ${cleanedStderr.trim().split('\n')[0].substring(0, 200)}`
			: '';
		return {
			type: 'agent_crashed',
			message: `Gemini CLI exited with code ${exitCode}${stderrPreview}`,
			recoverable: true,
			agentId: this.agentId,
			timestamp: Date.now(),
			raw: {
				exitCode,
				stderr,
				stdout,
			},
		};
	}
}
