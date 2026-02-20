import { createIpcMethod } from './ipcWrapper';

export interface McpSettings {
	figmaMcpEnabled: boolean;
	hasFigmaPat: boolean;
}

export interface McpToolDefinition {
	name: string;
	description?: string;
	inputSchema?: unknown;
}

export interface FigmaNodeVerificationResult {
	fileKey: string;
	nodeId: string;
	nodeName: string;
}

export interface FigmaExportImageResult {
	fileKey: string;
	nodeId: string;
	imagePath: string;
	imageUrl: string;
}

function getApi() {
	const api = window.maestro?.mcp;
	if (!api) {
		throw new Error('MCP bridge is unavailable. Restart Guru to load the latest preload script.');
	}
	return api;
}

export const mcpService = {
	getSettings: async (): Promise<McpSettings> =>
		createIpcMethod({
			call: () => getApi().getSettings(),
			errorContext: 'MCP settings load',
			rethrow: true,
		}),

	setSettings: async (settings: { figmaMcpEnabled?: boolean; figmaPat?: string }): Promise<McpSettings> =>
		createIpcMethod({
			call: () => getApi().setSettings(settings),
			errorContext: 'MCP settings save',
			rethrow: true,
		}),

	connect: async (command: string, args: string[]): Promise<{
		connected: boolean;
		serverInfo?: unknown;
		capabilities?: unknown;
	}> =>
		createIpcMethod({
			call: () => getApi().connect({ command, args }),
			errorContext: 'MCP connect',
			rethrow: true,
		}),

	listTools: async (): Promise<McpToolDefinition[]> =>
		createIpcMethod({
			call: () => getApi().listTools(),
			errorContext: 'MCP list tools',
			rethrow: true,
		}),

	verifyFigmaNode: async (figmaUrl: string): Promise<FigmaNodeVerificationResult> =>
		createIpcMethod({
			call: () => getApi().verifyFigmaNode({ figmaUrl }),
			errorContext: 'Figma node verification',
			rethrow: true,
		}),

	exportFigmaImage: async (figmaUrl: string): Promise<FigmaExportImageResult> =>
		createIpcMethod({
			call: () => getApi().exportFigmaImage({ figmaUrl }),
			errorContext: 'Figma image export',
			rethrow: true,
		}),

	callTool: async (name: string, argumentsPayload?: Record<string, unknown>): Promise<unknown> =>
		createIpcMethod({
			call: () => getApi().callTool({ name, arguments: argumentsPayload }),
			errorContext: `MCP tool call (${name})`,
			rethrow: true,
		}),

	disconnect: async (): Promise<{ success: boolean }> =>
		createIpcMethod({
			call: () => getApi().disconnect(),
			errorContext: 'MCP disconnect',
			rethrow: true,
		}),
};
