import { describe, it, expect } from 'vitest';
import { GeminiOutputParser } from '../../../main/parsers/gemini-output-parser';

describe('GeminiOutputParser', () => {
	const parser = new GeminiOutputParser();

	it('parses init events and captures session id', () => {
		const event = parser.parseJsonLine(JSON.stringify({ type: 'start', session_id: 'gem-123' }));
		expect(event?.type).toBe('init');
		expect(event?.sessionId).toBe('gem-123');
	});

	it('parses streaming text events as partial text', () => {
		const event = parser.parseJsonLine(JSON.stringify({ type: 'delta', delta: 'Hello' }));
		expect(event?.type).toBe('text');
		expect(event?.text).toBe('Hello');
		expect(event?.isPartial).toBe(true);
	});

	it('parses final result events with usage data', () => {
		const event = parser.parseJsonLine(
			JSON.stringify({
				type: 'result',
				text: 'Done',
				done: true,
				usage: {
					input_tokens: 12,
					output_tokens: 8,
					cache_read_tokens: 3,
					cache_write_tokens: 1,
				},
			})
		);

		expect(event?.type).toBe('result');
		expect(event?.text).toBe('Done');
		expect(event?.usage).toEqual({
			inputTokens: 12,
			outputTokens: 8,
			cacheReadTokens: 3,
			cacheCreationTokens: 1,
		});
	});

	it('falls back to plain text for non-JSON lines', () => {
		const event = parser.parseJsonLine('streaming plain text');
		expect(event?.type).toBe('text');
		expect(event?.text).toBe('streaming plain text');
		expect(event?.isPartial).toBe(true);
	});

	it('detects errors from JSON lines', () => {
		const error = parser.detectErrorFromLine(JSON.stringify({ type: 'error', error: 'invalid api key' }));
		expect(error).not.toBeNull();
		expect(error?.type).toBe('unknown');
		expect(error?.agentId).toBe('gemini-cli');
	});

	it('detects explicit plain-text error lines', () => {
		const error = parser.detectErrorFromLine('Error: some unexpected failure');
		expect(error).not.toBeNull();
		expect(error?.type).toBe('unknown');
		expect(error?.message).toContain('Error: some unexpected failure');
	});

	it('returns null from detectErrorFromExit for code 0', () => {
		expect(parser.detectErrorFromExit(0, '', '')).toBeNull();
	});
});
