import { ipcMain, safeStorage } from 'electron';
import type Store from 'electron-store';
import { withIpcErrorLogging, CreateHandlerOptions } from '../../utils/ipcHandler';
import type { MaestroSettings } from './persistence';
import { McpClientService } from '../../services/McpClientService';

const LOG_CONTEXT = '[MCP]';
const FIGMA_MCP_ENABLED_KEY = 'figmaMcpEnabled';
const FIGMA_PAT_ENCRYPTED_KEY = 'figmaPatEncrypted';

const handlerOpts = (operation: string): Pick<CreateHandlerOptions, 'context' | 'operation'> => ({
	context: LOG_CONTEXT,
	operation,
});

function ensureSecureStorageAvailable(): void {
	if (!safeStorage.isEncryptionAvailable()) {
		throw new Error('Secure storage is not available on this system');
	}
}

function encryptSecret(value: string): string {
	if (!value) return '';
	ensureSecureStorageAvailable();
	return safeStorage.encryptString(value).toString('base64');
}

function decryptSecret(value: string | undefined): string {
	if (!value) return '';
	ensureSecureStorageAvailable();
	return safeStorage.decryptString(Buffer.from(value, 'base64'));
}

function parseFigmaUrl(figmaUrl: string): { fileKey: string; nodeId: string } {
	const trimmed = figmaUrl.trim();
	if (!trimmed) {
		throw new Error('Figma URL is required');
	}

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(trimmed);
	} catch {
		throw new Error('Invalid Figma URL');
	}

	const host = parsedUrl.hostname.toLowerCase();
	if (host !== 'figma.com' && host !== 'www.figma.com') {
		throw new Error('Invalid Figma URL host');
	}

	const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
	const fileKey = pathParts[1]?.trim();
	if (!fileKey) {
		throw new Error('Figma file key is missing in URL');
	}

	const rawNodeId = parsedUrl.searchParams.get('node-id');
	if (!rawNodeId) {
		throw new Error('Figma URL must include node-id');
	}

	const nodeId = decodeURIComponent(rawNodeId).trim().replace(/-/g, ':');
	if (!nodeId) {
		throw new Error('Figma node-id is invalid');
	}

	return { fileKey, nodeId };
}

export interface McpHandlerDependencies {
	settingsStore: Store<MaestroSettings>;
	mcpClientService: McpClientService;
}

export function registerMcpHandlers(deps: McpHandlerDependencies): void {
	const { settingsStore, mcpClientService } = deps;

	ipcMain.handle(
		'mcp:getSettings',
		withIpcErrorLogging(
			handlerOpts('getSettings'),
			async (): Promise<{ figmaMcpEnabled: boolean; hasFigmaPat: boolean }> => {
				const encryptedPat = settingsStore.get(FIGMA_PAT_ENCRYPTED_KEY) as string | undefined;
				const figmaPat = decryptSecret(encryptedPat).trim();
				const figmaMcpEnabled = Boolean(settingsStore.get(FIGMA_MCP_ENABLED_KEY));
				return {
					figmaMcpEnabled,
					hasFigmaPat: Boolean(figmaPat),
				};
			}
		)
	);

	ipcMain.handle(
		'mcp:setSettings',
		withIpcErrorLogging(
			handlerOpts('setSettings'),
			async (payload: { figmaMcpEnabled?: boolean; figmaPat?: string }) => {
				if (typeof payload.figmaMcpEnabled === 'boolean') {
					settingsStore.set(FIGMA_MCP_ENABLED_KEY, payload.figmaMcpEnabled as any);
				}

				if (typeof payload.figmaPat === 'string') {
					const trimmedPat = payload.figmaPat.trim();
					settingsStore.set(FIGMA_PAT_ENCRYPTED_KEY, encryptSecret(trimmedPat) as any);
				}

				const encryptedPat = settingsStore.get(FIGMA_PAT_ENCRYPTED_KEY) as string | undefined;
				const figmaPat = decryptSecret(encryptedPat).trim();
				const figmaMcpEnabled = Boolean(settingsStore.get(FIGMA_MCP_ENABLED_KEY));
				return {
					figmaMcpEnabled,
					hasFigmaPat: Boolean(figmaPat),
				};
			}
		)
	);

	ipcMain.handle(
		'mcp:connect',
		withIpcErrorLogging(
			handlerOpts('connect'),
			async (payload: { command: string; args: string[] }) => {
				const command = (payload?.command || '').trim();
				const args = Array.isArray(payload?.args) ? payload.args : [];
				if (!command) {
					throw new Error('MCP command is required');
				}
				return mcpClientService.connectToServer(command, args);
			}
		)
	);

	ipcMain.handle(
		'mcp:verifyFigmaNode',
		withIpcErrorLogging(handlerOpts('verifyFigmaNode'), async (payload: { figmaUrl: string }) => {
			const figmaMcpEnabled = Boolean(settingsStore.get(FIGMA_MCP_ENABLED_KEY));
			if (!figmaMcpEnabled) {
				throw new Error('Enable Figma MCP in Settings first');
			}

			const encryptedPat = settingsStore.get(FIGMA_PAT_ENCRYPTED_KEY) as string | undefined;
			const figmaPat = decryptSecret(encryptedPat).trim();
			if (!figmaPat) {
				throw new Error('Add your Figma Personal Access Token in Settings first');
			}

			const { fileKey, nodeId } = parseFigmaUrl(payload?.figmaUrl || '');
			const endpoint = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(
				nodeId
			)}`;
			const response = await fetch(endpoint, {
				method: 'GET',
				headers: {
					'X-Figma-Token': figmaPat,
				},
			});

			let responseBody: unknown = null;
			try {
				responseBody = await response.json();
			} catch {
				responseBody = null;
			}

			if (!response.ok) {
				const errPayload =
					responseBody && typeof responseBody === 'object'
						? (responseBody as { err?: unknown; message?: unknown })
						: {};
				const errMessage =
					typeof errPayload.err === 'string'
						? errPayload.err
						: typeof errPayload.message === 'string'
							? errPayload.message
							: `Figma API request failed (${response.status})`;
				throw new Error(errMessage);
			}

			const data = responseBody && typeof responseBody === 'object' ? (responseBody as any) : null;
			const nodes = data?.nodes && typeof data.nodes === 'object' ? data.nodes : null;
			const dashedNodeId = nodeId.replace(/:/g, '-');
			const nodeContainer = nodes?.[nodeId] ?? nodes?.[dashedNodeId];
			const node =
				nodeContainer && typeof nodeContainer === 'object' ? (nodeContainer as any).document : undefined;
			const nodeName = typeof node?.name === 'string' ? node.name.trim() : '';
			if (!nodeName) {
				throw new Error('Figma node was found, but no node name was returned');
			}

			return {
				fileKey,
				nodeId,
				nodeName,
			};
		})
	);

	ipcMain.handle(
		'mcp:exportFigmaImage',
		withIpcErrorLogging(handlerOpts('exportFigmaImage'), async (payload: { figmaUrl: string }) => {
			const figmaMcpEnabled = Boolean(settingsStore.get(FIGMA_MCP_ENABLED_KEY));
			if (!figmaMcpEnabled) {
				throw new Error('Enable Figma MCP in Settings first');
			}

			const encryptedPat = settingsStore.get(FIGMA_PAT_ENCRYPTED_KEY) as string | undefined;
			const figmaPat = decryptSecret(encryptedPat).trim();
			if (!figmaPat) {
				throw new Error('Add your Figma Personal Access Token in Settings first');
			}

			const { fileKey, nodeId } = parseFigmaUrl(payload?.figmaUrl || '');
			return mcpClientService.figma_export_image({ fileKey, nodeId, figmaPat });
		})
	);

	ipcMain.handle(
		'mcp:listTools',
		withIpcErrorLogging(handlerOpts('listTools'), async () => mcpClientService.listTools())
	);

	ipcMain.handle(
		'mcp:callTool',
		withIpcErrorLogging(
			handlerOpts('callTool'),
			async (payload: { name: string; arguments?: Record<string, unknown> }) => {
				const name = (payload?.name || '').trim();
				if (!name) {
					throw new Error('Tool name is required');
				}
				const args = payload?.arguments && typeof payload.arguments === 'object' ? payload.arguments : {};
				return mcpClientService.callTool(name, args);
			}
		)
	);

	ipcMain.handle(
		'mcp:disconnect',
		withIpcErrorLogging(handlerOpts('disconnect'), async () => {
			mcpClientService.disconnect();
			return { success: true };
		})
	);
}
