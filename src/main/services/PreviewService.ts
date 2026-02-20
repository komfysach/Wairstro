import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import path from 'path';
import { createServer } from 'net';
import { execFileNoThrow } from '../utils/execFile';

interface PreviewProcessEntry {
	child: ChildProcess;
	port: number;
	worktreePath: string;
	mfeName: string;
	logFilePath: string;
	logLines: Array<{ source: 'stdout' | 'stderr'; text: string }>;
	appendQueue: Promise<void>;
}

interface StartPreviewResult {
	success: boolean;
	port: number;
	url: string;
}

interface PreviewStatusResult {
	running: boolean;
	port?: number;
	url?: string;
}

interface DevLogLine {
	source: 'stdout' | 'stderr';
	text: string;
}

const DEFAULT_PORT_START = 8081;
const DEFAULT_PORT_END = 8999;
const STARTUP_TIMEOUT_MS = 30_000;
const HEALTHCHECK_INTERVAL_MS = 300;
const STOP_TIMEOUT_MS = 3_000;
const MAX_LOG_LINES = 100;
const TERMINAL_ERROR_TAIL_LINES = 50;
const DEV_LOG_PREFIX_STDOUT = '[stdout]';
const DEV_LOG_PREFIX_STDERR = '[stderr]';

function normalizePathForKey(inputPath: string): string {
	const resolved = path.resolve(inputPath);
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function buildPreviewKey(worktreePath: string, mfeName: string): string {
	return `${normalizePathForKey(worktreePath)}::${mfeName.trim().toLowerCase()}`;
}

function isChildRunning(child: ChildProcess): boolean {
	return child.exitCode === null && !child.killed;
}

async function findOpenPort(startPort = DEFAULT_PORT_START, endPort = DEFAULT_PORT_END): Promise<number> {
	for (let port = startPort; port <= endPort; port += 1) {
		const isAvailable = await new Promise<boolean>((resolve) => {
			const server = createServer();
			server.once('error', () => resolve(false));
			server.once('listening', () => {
				server.close(() => resolve(true));
			});
			server.listen(port, '127.0.0.1');
		});
		if (isAvailable) {
			return port;
		}
	}
	throw new Error(`No available preview ports found in range ${startPort}-${endPort}.`);
}

async function waitForHttpReady(url: string, child: ChildProcess): Promise<void> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
		if (!isChildRunning(child)) {
			throw new Error('Preview process exited before the server became ready.');
		}

		try {
			const response = await fetch(url, { method: 'GET' });
			if (response.ok || response.status >= 300) {
				return;
			}
		} catch {
			// Continue polling until timeout.
		}

		await new Promise((resolve) => setTimeout(resolve, HEALTHCHECK_INTERVAL_MS));
	}

	throw new Error(`Preview server did not become ready within ${STARTUP_TIMEOUT_MS}ms.`);
}

async function stopChildProcess(child: ChildProcess): Promise<void> {
	if (!isChildRunning(child)) return;

	child.kill('SIGTERM');
	const exitedGracefully = await new Promise<boolean>((resolve) => {
		const timeout = setTimeout(() => resolve(false), STOP_TIMEOUT_MS);
		child.once('exit', () => {
			clearTimeout(timeout);
			resolve(true);
		});
	});

	if (!exitedGracefully && isChildRunning(child)) {
		child.kill('SIGKILL');
	}
}

function splitIntoLines(chunk: string): string[] {
	return chunk
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.split('\n')
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0);
}

function encodeLogLine(source: 'stdout' | 'stderr', line: string): string {
	const prefix = source === 'stderr' ? DEV_LOG_PREFIX_STDERR : DEV_LOG_PREFIX_STDOUT;
	return `${prefix} ${line}`;
}

function parseLogLine(rawLine: string): DevLogLine {
	const line = rawLine.trimEnd();
	if (line.startsWith(`${DEV_LOG_PREFIX_STDERR} `)) {
		return { source: 'stderr', text: line.slice(DEV_LOG_PREFIX_STDERR.length + 1) };
	}
	if (line.startsWith(`${DEV_LOG_PREFIX_STDOUT} `)) {
		return { source: 'stdout', text: line.slice(DEV_LOG_PREFIX_STDOUT.length + 1) };
	}
	return { source: 'stdout', text: line };
}

async function resolveBranchName(worktreePath: string): Promise<string> {
	const result = await execFileNoThrow('git', ['branch', '--show-current'], worktreePath);
	if (result.exitCode === 0) {
		const branch = result.stdout.trim();
		if (branch.length > 0) return branch;
	}
	return path.basename(worktreePath) || 'default';
}

function sanitizeBranchForDir(branch: string): string {
	return branch.replace(/[\\/]+/g, '__').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
}

async function resolveLogFilePath(worktreePath: string): Promise<string> {
	const branchName = await resolveBranchName(worktreePath);
	const branchDir = sanitizeBranchForDir(branchName);
	const dirPath = path.join(worktreePath, '.wairstro', 'worktrees', branchDir);
	await fs.mkdir(dirPath, { recursive: true });
	return path.join(dirPath, '.mfe-dev.log');
}

export class PreviewService {
	private readonly previews = new Map<string, PreviewProcessEntry>();

	private enqueueLogWrite(entry: PreviewProcessEntry, source: 'stdout' | 'stderr', lines: string[]): void {
		if (lines.length === 0) return;
		for (const line of lines) {
			entry.logLines.push({ source, text: line });
		}
		if (entry.logLines.length > MAX_LOG_LINES) {
			entry.logLines.splice(0, entry.logLines.length - MAX_LOG_LINES);
		}

		const payload = lines.map((line) => `${encodeLogLine(source, line)}\n`).join('');
		entry.appendQueue = entry.appendQueue
			.then(() => fs.appendFile(entry.logFilePath, payload, 'utf8'))
			.catch(() => {
				// Keep preview process resilient; log append failures are non-fatal.
			});
	}

	private async readLogTailFromDisk(worktreePath: string, lineCount: number): Promise<DevLogLine[]> {
		try {
			const logFilePath = await resolveLogFilePath(worktreePath);
			const raw = await fs.readFile(logFilePath, 'utf8');
			const lines = raw
				.replace(/\r\n/g, '\n')
				.replace(/\r/g, '\n')
				.split('\n')
				.filter((line) => line.trim().length > 0)
				.slice(-Math.max(1, lineCount));
			return lines.map(parseLogLine);
		} catch {
			return [];
		}
	}

	private async getLogLines(worktreePath: string, mfeName: string, lineCount: number): Promise<DevLogLine[]> {
		const key = buildPreviewKey(worktreePath, mfeName);
		const active = this.previews.get(key);
		if (active) {
			const tail = active.logLines.slice(-Math.max(1, lineCount));
			return tail.map((line) => ({ source: line.source, text: line.text }));
		}
		return this.readLogTailFromDisk(worktreePath, lineCount);
	}

	async startPreview(worktreePath: string, mfeName: string): Promise<StartPreviewResult> {
		const resolvedPath = path.resolve(worktreePath || '');
		const resolvedMfeName = mfeName?.trim() || 'mfe';
		if (!resolvedPath) {
			throw new Error('worktreePath is required.');
		}

		await fs.access(resolvedPath);

		const key = buildPreviewKey(resolvedPath, resolvedMfeName);
		const existing = this.previews.get(key);
		if (existing && isChildRunning(existing.child)) {
			return {
				success: true,
				port: existing.port,
				url: `http://localhost:${existing.port}`,
			};
		}
		if (existing) {
			this.previews.delete(key);
		}

		const port = await findOpenPort();
		const logFilePath = await resolveLogFilePath(resolvedPath);
		await fs.writeFile(logFilePath, '', 'utf8');

		const child = spawn('npm', ['run', 'start', '--', '--port', String(port)], {
			cwd: resolvedPath,
			env: process.env,
			shell: process.platform === 'win32',
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		const stderrChunks: string[] = [];

		const entry: PreviewProcessEntry = {
			child,
			port,
			worktreePath: resolvedPath,
			mfeName: resolvedMfeName,
			logFilePath,
			logLines: [],
			appendQueue: Promise.resolve(),
		};
		this.previews.set(key, entry);

		child.stdout?.on('data', (chunk) => {
			this.enqueueLogWrite(entry, 'stdout', splitIntoLines(String(chunk)));
		});
		child.stderr?.on('data', (chunk) => {
			const lines = splitIntoLines(String(chunk));
			stderrChunks.push(...lines);
			if (stderrChunks.length > 10) {
				stderrChunks.splice(0, stderrChunks.length - 10);
			}
			this.enqueueLogWrite(entry, 'stderr', lines);
		});

		try {
			await waitForHttpReady(`http://localhost:${port}`, child);
			return {
				success: true,
				port,
				url: `http://localhost:${port}`,
			};
		} catch (error) {
			this.previews.delete(key);
			await stopChildProcess(child);
			const stderrPreview = stderrChunks.join('\n').trim();
			const message =
				error instanceof Error ? error.message : 'Failed to start preview server.';
			throw new Error(stderrPreview ? `${message}\n${stderrPreview}` : message);
		}
	}

	async stopPreview(worktreePath: string, mfeName: string): Promise<boolean> {
		const key = buildPreviewKey(worktreePath, mfeName);
		const entry = this.previews.get(key);
		if (!entry) return false;
		this.previews.delete(key);
		await stopChildProcess(entry.child);
		return true;
	}

	getPreviewStatus(worktreePath: string, mfeName: string): PreviewStatusResult {
		const key = buildPreviewKey(worktreePath, mfeName);
		const entry = this.previews.get(key);
		if (!entry || !isChildRunning(entry.child)) {
			if (entry) {
				this.previews.delete(key);
			}
			return { running: false };
		}

		return {
			running: true,
			port: entry.port,
			url: `http://localhost:${entry.port}`,
		};
	}

	async getTerminalErrors(worktreePath: string, mfeName: string): Promise<string> {
		const lines = await this.getLogLines(worktreePath, mfeName, TERMINAL_ERROR_TAIL_LINES);
		return lines.map((line) => encodeLogLine(line.source, line.text)).join('\n');
	}

	async getDevServerLogs(
		worktreePath: string,
		mfeName: string,
		lineCount = TERMINAL_ERROR_TAIL_LINES
	): Promise<DevLogLine[]> {
		return this.getLogLines(worktreePath, mfeName, lineCount);
	}

	async stopAll(): Promise<void> {
		const entries = Array.from(this.previews.values());
		this.previews.clear();
		await Promise.all(entries.map((entry) => stopChildProcess(entry.child)));
	}
}
