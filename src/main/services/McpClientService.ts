import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: number | string;
	result?: unknown;
	error?: JsonRpcError;
}

interface JsonRpcNotification {
	jsonrpc: '2.0';
	method: string;
	params?: unknown;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

interface ConnectResult {
	connected: boolean;
	serverInfo?: unknown;
	capabilities?: unknown;
}

interface ListToolsResponse {
	tools?: Array<{
		name: string;
		description?: string;
		inputSchema?: unknown;
	}>;
}

interface CallToolResponse {
	content?: unknown;
	isError?: boolean;
	[_: string]: unknown;
}

interface FigmaExportImageResult {
	fileKey: string;
	nodeId: string;
	imagePath: string;
	imageUrl: string;
}

const JSON_RPC_VERSION = '2.0';
const DEFAULT_TIMEOUT_MS = 30_000;
const FIGMA_EXPORT_SCALE = 2;

export class McpClientService extends EventEmitter {
	private childProcess: ChildProcessWithoutNullStreams | null = null;
	private nextRequestId = 1;
	private pendingRequests = new Map<number, PendingRequest>();
	private stdoutBuffer = Buffer.alloc(0);
	private initialized = false;

	async connectToServer(command: string, args: string[]): Promise<ConnectResult> {
		if (!command.trim()) {
			throw new Error('MCP command is required');
		}

		if (this.childProcess) {
			this.disconnect();
		}

		this.childProcess = spawn(command, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			shell: false,
			env: { ...process.env },
		});

		this.childProcess.stdout.on('data', (chunk: Buffer) => {
			this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
			this.processIncomingBuffer();
		});

		this.childProcess.stderr.on('data', (chunk: Buffer) => {
			this.emit('stderr', chunk.toString('utf8'));
		});

		this.childProcess.on('error', (error: Error) => {
			this.rejectAllPending(error);
			this.initialized = false;
			this.emit('error', error);
		});

		this.childProcess.on('exit', (code, signal) => {
			this.rejectAllPending(
				new Error(`MCP server exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`)
			);
			this.initialized = false;
			this.childProcess = null;
			this.stdoutBuffer = Buffer.alloc(0);
			this.emit('exit', { code, signal });
		});

		const initializeResult = (await this.request('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: {
				name: 'maestro',
				version: '0.1.0',
			},
		})) as { serverInfo?: unknown; capabilities?: unknown };

		this.notify('notifications/initialized', {});
		this.initialized = true;

		return {
			connected: true,
			serverInfo: initializeResult.serverInfo,
			capabilities: initializeResult.capabilities,
		};
	}

	async listTools(): Promise<ListToolsResponse['tools']> {
		this.ensureConnected();
		const response = (await this.request('tools/list', {})) as ListToolsResponse;
		return response.tools || [];
	}

	async callTool(name: string, argumentsPayload: Record<string, unknown> = {}): Promise<CallToolResponse> {
		this.ensureConnected();
		if (!name.trim()) {
			throw new Error('Tool name is required');
		}

		return (await this.request('tools/call', {
			name,
			arguments: argumentsPayload,
		})) as CallToolResponse;
	}

	async figma_export_image(payload: {
		fileKey: string;
		nodeId: string;
		figmaPat: string;
	}): Promise<FigmaExportImageResult> {
		const fileKey = payload.fileKey.trim();
		const nodeId = payload.nodeId.trim();
		const figmaPat = payload.figmaPat.trim();
		if (!fileKey) {
			throw new Error('Figma file key is required');
		}
		if (!nodeId) {
			throw new Error('Figma node id is required');
		}
		if (!figmaPat) {
			throw new Error('Figma token is required');
		}

		const endpoint = `https://api.figma.com/v1/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(
			nodeId
		)}&format=png&scale=${FIGMA_EXPORT_SCALE}`;
		const exportResponse = await fetch(endpoint, {
			method: 'GET',
			headers: {
				'X-Figma-Token': figmaPat,
			},
		});

		let exportBody: unknown = null;
		try {
			exportBody = await exportResponse.json();
		} catch {
			exportBody = null;
		}

		if (!exportResponse.ok) {
			const errPayload =
				exportBody && typeof exportBody === 'object'
					? (exportBody as { err?: unknown; message?: unknown })
					: {};
			const errMessage =
				typeof errPayload.err === 'string'
					? errPayload.err
					: typeof errPayload.message === 'string'
						? errPayload.message
						: `Figma image export failed (${exportResponse.status})`;
			throw new Error(errMessage);
		}

		const body = exportBody && typeof exportBody === 'object' ? (exportBody as Record<string, unknown>) : {};
		const images = body.images && typeof body.images === 'object' ? (body.images as Record<string, unknown>) : {};
		const dashedNodeId = nodeId.replace(/:/g, '-');
		const imageSource =
			(typeof images[nodeId] === 'string' ? images[nodeId] : undefined) ||
			(typeof images[dashedNodeId] === 'string' ? images[dashedNodeId] : undefined);
		if (!imageSource) {
			throw new Error('Figma did not return an export image URL for this node');
		}

		const imageResponse = await fetch(imageSource, { method: 'GET' });
		if (!imageResponse.ok) {
			throw new Error(`Failed to download exported Figma image (${imageResponse.status})`);
		}
		const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
		if (imageBytes.length === 0) {
			throw new Error('Downloaded Figma image was empty');
		}

		const assetsDir = path.join(process.cwd(), '.wairstro', 'assets');
		await mkdir(assetsDir, { recursive: true });

		const safeFileKey = fileKey.replace(/[^a-zA-Z0-9_-]/g, '-');
		const safeNodeId = nodeId.replace(/[^a-zA-Z0-9:_-]/g, '-').replace(/:/g, '-');
		const fileName = `figma-${safeFileKey}-${safeNodeId}-${Date.now()}.png`;
		const imagePath = path.join(assetsDir, fileName);
		await writeFile(imagePath, imageBytes);

		return {
			fileKey,
			nodeId,
			imagePath,
			imageUrl: pathToFileURL(imagePath).toString(),
		};
	}

	disconnect(): void {
		if (!this.childProcess) return;

		this.childProcess.removeAllListeners('error');
		this.childProcess.removeAllListeners('exit');
		this.childProcess.stdout.removeAllListeners('data');
		this.childProcess.stderr.removeAllListeners('data');
		this.childProcess.kill();
		this.childProcess = null;
		this.initialized = false;
		this.stdoutBuffer = Buffer.alloc(0);
		this.rejectAllPending(new Error('MCP client disconnected'));
	}

	private ensureConnected(): void {
		if (!this.childProcess || !this.initialized) {
			throw new Error('MCP server is not connected');
		}
	}

	private request(method: string, params: Record<string, unknown>): Promise<unknown> {
		if (!this.childProcess) {
			throw new Error('MCP server is not connected');
		}

		const id = this.nextRequestId++;
		const payload = {
			jsonrpc: JSON_RPC_VERSION,
			id,
			method,
			params,
		};

		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`MCP request timed out: ${method}`));
			}, DEFAULT_TIMEOUT_MS);

			this.pendingRequests.set(id, { resolve, reject, timer });
			this.writeMessage(payload);
		});
	}

	private notify(method: string, params: Record<string, unknown>): void {
		if (!this.childProcess) return;
		this.writeMessage({
			jsonrpc: JSON_RPC_VERSION,
			method,
			params,
		});
	}

	private writeMessage(message: Record<string, unknown>): void {
		if (!this.childProcess?.stdin.writable) {
			throw new Error('MCP server stdin is not writable');
		}

		const body = Buffer.from(JSON.stringify(message), 'utf8');
		const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
		this.childProcess.stdin.write(Buffer.concat([header, body]));
	}

	private processIncomingBuffer(): void {
		while (this.stdoutBuffer.length > 0) {
			const headerEnd = this.stdoutBuffer.indexOf('\r\n\r\n');
			if (headerEnd !== -1) {
				const header = this.stdoutBuffer.slice(0, headerEnd).toString('utf8');
				const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
				if (!contentLengthMatch) {
					this.stdoutBuffer = this.stdoutBuffer.slice(headerEnd + 4);
					continue;
				}

				const contentLength = Number(contentLengthMatch[1]);
				const frameLength = headerEnd + 4 + contentLength;
				if (this.stdoutBuffer.length < frameLength) {
					return;
				}

				const body = this.stdoutBuffer.slice(headerEnd + 4, frameLength).toString('utf8');
				this.stdoutBuffer = this.stdoutBuffer.slice(frameLength);
				this.handleMessage(body);
				continue;
			}

			// Wait for the full header frame if this is a content-length message.
			const maybeHeaderPrefix = this.stdoutBuffer.slice(0, Math.min(this.stdoutBuffer.length, 32)).toString('utf8');
			if (/^Content-Length:/i.test(maybeHeaderPrefix)) {
				return;
			}

			const newlineIndex = this.stdoutBuffer.indexOf('\n');
			if (newlineIndex === -1) {
				return;
			}

			const line = this.stdoutBuffer.slice(0, newlineIndex).toString('utf8').trim();
			this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
			if (!line) continue;
			this.handleMessage(line);
		}
	}

	private handleMessage(rawMessage: string): void {
		let parsed: JsonRpcResponse | JsonRpcNotification;
		try {
			parsed = JSON.parse(rawMessage) as JsonRpcResponse | JsonRpcNotification;
		} catch {
			this.emit('message', rawMessage);
			return;
		}

		if ('id' in parsed) {
			const requestId = Number(parsed.id);
			const pending = this.pendingRequests.get(requestId);
			if (!pending) {
				return;
			}
			clearTimeout(pending.timer);
			this.pendingRequests.delete(requestId);

			if (parsed.error) {
				pending.reject(new Error(parsed.error.message || 'MCP request failed'));
				return;
			}

			pending.resolve(parsed.result);
			return;
		}

		this.emit('notification', parsed);
	}

	private rejectAllPending(error: Error): void {
		for (const [, pending] of this.pendingRequests) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pendingRequests.clear();
	}
}
