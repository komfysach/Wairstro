import { ipcRenderer } from 'electron';

export interface McpApi {
	getSettings: () => Promise<{ figmaMcpEnabled: boolean; hasFigmaPat: boolean }>;
	setSettings: (settings: { figmaMcpEnabled?: boolean; figmaPat?: string }) => Promise<{
		figmaMcpEnabled: boolean;
		hasFigmaPat: boolean;
	}>;
	connect: (payload: { command: string; args: string[] }) => Promise<{
		connected: boolean;
		serverInfo?: unknown;
		capabilities?: unknown;
	}>;
	listTools: () => Promise<
		Array<{
			name: string;
			description?: string;
			inputSchema?: unknown;
		}>
	>;
	verifyFigmaNode: (payload: { figmaUrl: string }) => Promise<{
		fileKey: string;
		nodeId: string;
		nodeName: string;
	}>;
	exportFigmaImage: (payload: { figmaUrl: string }) => Promise<{
		fileKey: string;
		nodeId: string;
		imagePath: string;
		imageUrl: string;
	}>;
	callTool: (payload: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>;
	disconnect: () => Promise<{ success: boolean }>;
}

export function createMcpApi(): McpApi {
	return {
		getSettings: () => ipcRenderer.invoke('mcp:getSettings'),
		setSettings: (settings) => ipcRenderer.invoke('mcp:setSettings', settings),
		connect: (payload) => ipcRenderer.invoke('mcp:connect', payload),
		listTools: () => ipcRenderer.invoke('mcp:listTools'),
		verifyFigmaNode: (payload) => ipcRenderer.invoke('mcp:verifyFigmaNode', payload),
		exportFigmaImage: (payload) => ipcRenderer.invoke('mcp:exportFigmaImage', payload),
		callTool: (payload) => ipcRenderer.invoke('mcp:callTool', payload),
		disconnect: () => ipcRenderer.invoke('mcp:disconnect'),
	};
}
