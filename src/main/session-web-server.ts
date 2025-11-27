import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { randomUUID } from 'crypto';
import { WebSocket } from 'ws';

const GITHUB_REDIRECT_URL = 'https://github.com/pedramamini/Maestro';

// Find a random available port in the ephemeral range
async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const server = net.createServer();
    server.listen(0, '0.0.0.0', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

interface SessionData {
  id: string;
  name: string;
  toolType: string;
  state: string;
  inputMode: string;
  cwd: string;
  aiLogs: Array<{
    id: string;
    timestamp: number;
    source: string;
    content: string;
  }>;
  shellLogs: Array<{
    id: string;
    timestamp: number;
    source: string;
    content: string;
  }>;
}

type GetSessionDataFn = (sessionId: string) => SessionData | null;
type WriteToSessionFn = (sessionId: string, data: string) => boolean;

/**
 * SessionWebServer - Per-session HTTP/WebSocket server for browser access
 *
 * Each session can have its own web server instance that:
 * - Binds to a random high port on 0.0.0.0
 * - Uses a UUID token for authentication
 * - Serves a web UI for viewing and interacting with the session
 * - Streams real-time log updates via WebSocket
 */
export class SessionWebServer {
  private server: FastifyInstance;
  private port: number = 0;
  private uuid: string;
  private sessionId: string;
  private isRunning: boolean = false;
  private getSessionData: GetSessionDataFn;
  private writeToSession: WriteToSessionFn;
  private wsClients: Set<WebSocket> = new Set();

  constructor(
    sessionId: string,
    getSessionData: GetSessionDataFn,
    writeToSession: WriteToSessionFn
  ) {
    this.sessionId = sessionId;
    this.uuid = randomUUID();
    this.getSessionData = getSessionData;
    this.writeToSession = writeToSession;

    this.server = Fastify({
      logger: false, // Disable logging for cleaner output
    });

    this.setupMiddleware();
    this.setupRoutes();
  }

  private async setupMiddleware() {
    await this.server.register(cors, {
      origin: true,
    });

    await this.server.register(websocket);
  }

  private setupRoutes() {
    // Root path - redirect to GitHub
    this.server.get('/', async (_request, reply) => {
      return reply.redirect(302, GITHUB_REDIRECT_URL);
    });

    // Catch-all for invalid UUIDs - redirect to GitHub
    this.server.get('/:uuid', async (request, reply) => {
      const { uuid } = request.params as { uuid: string };

      if (uuid !== this.uuid) {
        return reply.redirect(302, GITHUB_REDIRECT_URL);
      }

      // Serve the main UI
      return reply.type('text/html').send(this.generateHtml());
    });

    // Session data API
    this.server.get('/:uuid/api/session', async (request, reply) => {
      const { uuid } = request.params as { uuid: string };

      if (uuid !== this.uuid) {
        return reply.redirect(302, GITHUB_REDIRECT_URL);
      }

      const session = this.getSessionData(this.sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      return {
        id: session.id,
        name: session.name,
        toolType: session.toolType,
        state: session.state,
        inputMode: session.inputMode,
        cwd: session.cwd,
      };
    });

    // Logs API
    this.server.get('/:uuid/api/logs', async (request, reply) => {
      const { uuid } = request.params as { uuid: string };

      if (uuid !== this.uuid) {
        return reply.redirect(302, GITHUB_REDIRECT_URL);
      }

      const session = this.getSessionData(this.sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      // Return logs based on current input mode
      const logs = session.inputMode === 'ai' ? session.aiLogs : session.shellLogs;
      return { logs, inputMode: session.inputMode };
    });

    // Input API - send command to session
    this.server.post('/:uuid/api/input', async (request, reply) => {
      const { uuid } = request.params as { uuid: string };

      if (uuid !== this.uuid) {
        return reply.redirect(302, GITHUB_REDIRECT_URL);
      }

      const { input } = request.body as { input: string };
      if (!input) {
        return reply.status(400).send({ error: 'Input required' });
      }

      const success = this.writeToSession(this.sessionId, input + '\n');
      return { success };
    });

    // WebSocket for real-time updates
    this.server.get('/:uuid/ws', { websocket: true }, (connection, request) => {
      const params = request.params as { uuid: string };

      if (params.uuid !== this.uuid) {
        connection.socket.close(4001, 'Invalid UUID');
        return;
      }

      this.wsClients.add(connection.socket);

      connection.socket.on('close', () => {
        this.wsClients.delete(connection.socket);
      });

      connection.socket.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          if (data.type === 'input' && data.content) {
            this.writeToSession(this.sessionId, data.content + '\n');
          }
        } catch {
          // Ignore invalid messages
        }
      });

      // Send initial connection confirmation
      connection.socket.send(JSON.stringify({
        type: 'connected',
        sessionId: this.sessionId,
      }));
    });

    // Static assets (CSS served inline in HTML for simplicity)
    this.server.get('/:uuid/styles.css', async (request, reply) => {
      const { uuid } = request.params as { uuid: string };
      if (uuid !== this.uuid) {
        return reply.redirect(302, GITHUB_REDIRECT_URL);
      }
      return reply.type('text/css').send(this.generateCss());
    });

    // JavaScript
    this.server.get('/:uuid/app.js', async (request, reply) => {
      const { uuid } = request.params as { uuid: string };
      if (uuid !== this.uuid) {
        return reply.redirect(302, GITHUB_REDIRECT_URL);
      }
      return reply.type('application/javascript').send(this.generateJs());
    });
  }

  /**
   * Broadcast a message to all connected WebSocket clients
   */
  broadcast(message: object) {
    const data = JSON.stringify(message);
    for (const client of this.wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * Broadcast new log entry to all clients
   */
  broadcastLog(log: { id: string; timestamp: number; source: string; content: string }, inputMode: string) {
    this.broadcast({
      type: 'log',
      log,
      inputMode,
    });
  }

  /**
   * Broadcast session state change
   */
  broadcastState(state: string) {
    this.broadcast({
      type: 'state',
      state,
    });
  }

  async start(): Promise<{ port: number; uuid: string; url: string }> {
    if (this.isRunning) {
      return { port: this.port, uuid: this.uuid, url: this.getUrl() };
    }

    try {
      this.port = await findAvailablePort();
      await this.server.listen({ port: this.port, host: '0.0.0.0' });
      this.isRunning = true;
      console.log(`Session web server started: ${this.getUrl()}`);
      return { port: this.port, uuid: this.uuid, url: this.getUrl() };
    } catch (error) {
      console.error('Failed to start session web server:', error);
      throw error;
    }
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }

    try {
      // Close all WebSocket connections
      for (const client of this.wsClients) {
        client.close(1000, 'Server shutting down');
      }
      this.wsClients.clear();

      await this.server.close();
      this.isRunning = false;
      console.log(`Session web server stopped for session ${this.sessionId}`);
    } catch (error) {
      console.error('Failed to stop session web server:', error);
    }
  }

  getUrl(): string {
    return `http://localhost:${this.port}/${this.uuid}`;
  }

  getPort(): number {
    return this.port;
  }

  getUuid(): string {
    return this.uuid;
  }

  isActive(): boolean {
    return this.isRunning;
  }

  private generateHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Maestro - Session View</title>
  <link rel="stylesheet" href="/${this.uuid}/styles.css">
</head>
<body>
  <div id="app">
    <header>
      <div class="header-left">
        <h1>MAESTRO</h1>
        <span id="session-name" class="session-name">Loading...</span>
        <span id="session-state" class="state-badge">--</span>
      </div>
      <div class="header-right">
        <span id="tool-type" class="tool-badge">--</span>
        <span id="input-mode" class="mode-badge">--</span>
      </div>
    </header>

    <main>
      <div id="logs" class="logs-container"></div>
    </main>

    <footer>
      <form id="input-form">
        <input type="text" id="input-field" placeholder="Type a command..." autocomplete="off" />
        <button type="submit">Send</button>
      </form>
      <div class="connection-status">
        <span id="ws-status" class="ws-indicator disconnected"></span>
        <span id="ws-status-text">Disconnected</span>
      </div>
    </footer>
  </div>
  <script src="/${this.uuid}/app.js"></script>
</body>
</html>`;
  }

  private generateCss(): string {
    return `
:root {
  --bg-main: #0d1117;
  --bg-sidebar: #161b22;
  --bg-activity: #21262d;
  --border: #30363d;
  --text-main: #e6edf3;
  --text-dim: #7d8590;
  --accent: #58a6ff;
  --success: #3fb950;
  --warning: #d29922;
  --error: #f85149;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  background-color: var(--bg-main);
  color: var(--text-main);
  height: 100vh;
  overflow: hidden;
}

#app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background-color: var(--bg-sidebar);
  border-bottom: 1px solid var(--border);
}

.header-left, .header-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

h1 {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--accent);
}

.session-name {
  font-size: 0.875rem;
  color: var(--text-main);
}

.state-badge, .tool-badge, .mode-badge {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  padding: 0.25rem 0.5rem;
  border-radius: 9999px;
  border: 1px solid;
}

.state-badge {
  border-color: var(--success);
  color: var(--success);
  background-color: rgba(63, 185, 80, 0.1);
}

.state-badge.busy {
  border-color: var(--warning);
  color: var(--warning);
  background-color: rgba(210, 153, 34, 0.1);
}

.state-badge.error {
  border-color: var(--error);
  color: var(--error);
  background-color: rgba(248, 81, 73, 0.1);
}

.tool-badge {
  border-color: var(--accent);
  color: var(--accent);
  background-color: rgba(88, 166, 255, 0.1);
}

.mode-badge {
  border-color: var(--text-dim);
  color: var(--text-dim);
  background-color: var(--bg-activity);
}

main {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.logs-container {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
  font-size: 0.8125rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.log-entry {
  margin-bottom: 0.25rem;
  padding: 0.25rem 0;
}

.log-entry.stdin {
  color: var(--accent);
}

.log-entry.stdout {
  color: var(--text-main);
}

.log-entry.stderr {
  color: var(--error);
}

.log-entry.system {
  color: var(--text-dim);
  font-style: italic;
}

footer {
  padding: 1rem 1.5rem;
  background-color: var(--bg-sidebar);
  border-top: 1px solid var(--border);
  display: flex;
  gap: 1rem;
  align-items: center;
}

#input-form {
  flex: 1;
  display: flex;
  gap: 0.5rem;
}

#input-field {
  flex: 1;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background-color: var(--bg-main);
  color: var(--text-main);
  font-family: inherit;
  font-size: 0.875rem;
  outline: none;
}

#input-field:focus {
  border-color: var(--accent);
}

button[type="submit"] {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 0.375rem;
  background-color: var(--accent);
  color: white;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

button[type="submit"]:hover {
  opacity: 0.9;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-dim);
}

.ws-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--error);
}

.ws-indicator.connected {
  background-color: var(--success);
}

.ws-indicator.disconnected {
  background-color: var(--error);
}

/* Scrollbar styling */
.logs-container::-webkit-scrollbar {
  width: 8px;
}

.logs-container::-webkit-scrollbar-track {
  background: var(--bg-main);
}

.logs-container::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}

.logs-container::-webkit-scrollbar-thumb:hover {
  background: var(--text-dim);
}

/* Mobile responsive */
@media (max-width: 640px) {
  header {
    flex-direction: column;
    gap: 0.75rem;
    align-items: flex-start;
  }

  footer {
    flex-direction: column;
  }

  #input-form {
    width: 100%;
  }

  .connection-status {
    width: 100%;
    justify-content: center;
  }
}
`;
  }

  private generateJs(): string {
    return `
(function() {
  const uuid = '${this.uuid}';
  const sessionId = '${this.sessionId}';

  let ws = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;
  const reconnectDelay = 2000;

  const logsContainer = document.getElementById('logs');
  const inputForm = document.getElementById('input-form');
  const inputField = document.getElementById('input-field');
  const sessionName = document.getElementById('session-name');
  const sessionState = document.getElementById('session-state');
  const toolType = document.getElementById('tool-type');
  const inputMode = document.getElementById('input-mode');
  const wsStatus = document.getElementById('ws-status');
  const wsStatusText = document.getElementById('ws-status-text');

  // Fetch initial session data
  async function fetchSessionData() {
    try {
      const response = await fetch('/' + uuid + '/api/session');
      if (response.ok) {
        const data = await response.json();
        updateSessionInfo(data);
      }
    } catch (error) {
      console.error('Failed to fetch session data:', error);
    }
  }

  // Fetch initial logs
  async function fetchLogs() {
    try {
      const response = await fetch('/' + uuid + '/api/logs');
      if (response.ok) {
        const data = await response.json();
        renderLogs(data.logs);
        inputMode.textContent = data.inputMode.toUpperCase();
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    }
  }

  function updateSessionInfo(data) {
    sessionName.textContent = data.name;
    sessionState.textContent = data.state.toUpperCase();
    sessionState.className = 'state-badge ' + (data.state === 'busy' ? 'busy' : data.state === 'error' ? 'error' : '');
    toolType.textContent = data.toolType.toUpperCase().replace('-', ' ');
    inputMode.textContent = data.inputMode.toUpperCase();
  }

  function clearLogs() {
    while (logsContainer.firstChild) {
      logsContainer.removeChild(logsContainer.firstChild);
    }
  }

  function renderLogs(logs) {
    clearLogs();
    logs.forEach(function(log) { appendLog(log); });
    scrollToBottom();
  }

  function appendLog(log) {
    const entry = document.createElement('div');
    entry.className = 'log-entry ' + log.source;
    entry.textContent = log.content;
    logsContainer.appendChild(entry);
  }

  function scrollToBottom() {
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }

  function setConnectionStatus(connected) {
    wsStatus.className = 'ws-indicator ' + (connected ? 'connected' : 'disconnected');
    wsStatusText.textContent = connected ? 'Connected' : 'Disconnected';
  }

  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + window.location.host + '/' + uuid + '/ws';

    ws = new WebSocket(wsUrl);

    ws.onopen = function() {
      console.log('WebSocket connected');
      setConnectionStatus(true);
      reconnectAttempts = 0;
    };

    ws.onclose = function() {
      console.log('WebSocket disconnected');
      setConnectionStatus(false);

      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        setTimeout(connectWebSocket, reconnectDelay);
      }
    };

    ws.onerror = function(error) {
      console.error('WebSocket error:', error);
    };

    ws.onmessage = function(event) {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'log':
            appendLog(data.log);
            scrollToBottom();
            if (data.inputMode) {
              inputMode.textContent = data.inputMode.toUpperCase();
            }
            break;
          case 'state':
            sessionState.textContent = data.state.toUpperCase();
            sessionState.className = 'state-badge ' + (data.state === 'busy' ? 'busy' : data.state === 'error' ? 'error' : '');
            break;
          case 'connected':
            console.log('Session connected:', data.sessionId);
            break;
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };
  }

  // Handle form submission
  inputForm.addEventListener('submit', async function(e) {
    e.preventDefault();

    const input = inputField.value.trim();
    if (!input) return;

    try {
      // Send via WebSocket if connected, otherwise via HTTP
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', content: input }));
      } else {
        await fetch('/' + uuid + '/api/input', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: input }),
        });
      }

      inputField.value = '';
    } catch (error) {
      console.error('Failed to send input:', error);
    }
  });

  // Initialize
  fetchSessionData();
  fetchLogs();
  connectWebSocket();

  // Periodically refresh session state
  setInterval(fetchSessionData, 10000);
})();
`;
  }
}

// Manager for multiple session web servers
export class SessionWebServerManager {
  private servers: Map<string, SessionWebServer> = new Map();
  private getSessionData: GetSessionDataFn;
  private writeToSession: WriteToSessionFn;

  constructor(getSessionData: GetSessionDataFn, writeToSession: WriteToSessionFn) {
    this.getSessionData = getSessionData;
    this.writeToSession = writeToSession;
  }

  async startServer(sessionId: string): Promise<{ port: number; uuid: string; url: string }> {
    // Stop existing server if any
    await this.stopServer(sessionId);

    const server = new SessionWebServer(sessionId, this.getSessionData, this.writeToSession);
    const result = await server.start();
    this.servers.set(sessionId, server);
    return result;
  }

  async stopServer(sessionId: string): Promise<void> {
    const server = this.servers.get(sessionId);
    if (server) {
      await server.stop();
      this.servers.delete(sessionId);
    }
  }

  getServer(sessionId: string): SessionWebServer | undefined {
    return this.servers.get(sessionId);
  }

  getStatus(sessionId: string): { active: boolean; port?: number; uuid?: string; url?: string } {
    const server = this.servers.get(sessionId);
    if (!server || !server.isActive()) {
      return { active: false };
    }
    return {
      active: true,
      port: server.getPort(),
      uuid: server.getUuid(),
      url: server.getUrl(),
    };
  }

  /**
   * Broadcast a log entry to clients of a specific session
   */
  broadcastLog(sessionId: string, log: { id: string; timestamp: number; source: string; content: string }, inputMode: string) {
    const server = this.servers.get(sessionId);
    if (server?.isActive()) {
      server.broadcastLog(log, inputMode);
    }
  }

  /**
   * Broadcast state change to clients of a specific session
   */
  broadcastState(sessionId: string, state: string) {
    const server = this.servers.get(sessionId);
    if (server?.isActive()) {
      server.broadcastState(state);
    }
  }

  async stopAll(): Promise<void> {
    const promises = Array.from(this.servers.keys()).map(id => this.stopServer(id));
    await Promise.all(promises);
  }
}
