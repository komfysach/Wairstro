// Human-readable output formatter for CLI
// Provides beautiful, colored terminal output

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Bright foreground colors
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
};

// Check if stdout supports colors
const supportsColor = process.stdout.isTTY;

function c(color: keyof typeof colors, text: string): string {
  if (!supportsColor) return text;
  return `${colors[color]}${text}${colors.reset}`;
}

function bold(text: string): string {
  return c('bold', text);
}

function dim(text: string): string {
  return c('dim', text);
}

// Format helpers
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

// Group formatting
export interface GroupDisplay {
  id: string;
  name: string;
  emoji?: string;
  collapsed?: boolean;
}

export function formatGroups(groups: GroupDisplay[]): string {
  if (groups.length === 0) {
    return dim('No groups found.');
  }

  const lines: string[] = [];
  lines.push(bold(c('cyan', 'GROUPS')) + dim(` (${groups.length})`));
  lines.push('');

  for (const group of groups) {
    const emoji = group.emoji || '📁';
    const name = c('white', group.name);
    const id = dim(group.id);
    lines.push(`  ${emoji}  ${name}`);
    lines.push(`      ${id}`);
  }

  return lines.join('\n');
}

// Agent formatting
export interface AgentDisplay {
  id: string;
  name: string;
  toolType: string;
  cwd: string;
  groupId?: string;
  autoRunFolderPath?: string;
}

export function formatAgents(agents: AgentDisplay[], groupName?: string): string {
  if (agents.length === 0) {
    return dim('No agents found.');
  }

  const lines: string[] = [];
  const title = groupName
    ? bold(c('cyan', 'AGENTS')) + dim(` in ${groupName} (${agents.length})`)
    : bold(c('cyan', 'AGENTS')) + dim(` (${agents.length})`);
  lines.push(title);
  lines.push('');

  for (const agent of agents) {
    const name = c('white', agent.name);
    const toolType = c('green', agent.toolType);
    const cwd = dim(truncate(agent.cwd, 60));
    const id = dim(agent.id);
    const autoRun = agent.autoRunFolderPath ? c('yellow', ' [Auto Run]') : '';

    lines.push(`  ${name} ${toolType}${autoRun}`);
    lines.push(`      ${cwd}`);
    lines.push(`      ${id}`);
  }

  return lines.join('\n');
}

// Playbook formatting
export interface PlaybookDocDisplay {
  filename: string;
  resetOnCompletion: boolean;
}

export interface PlaybookDisplay {
  id: string;
  name: string;
  sessionId: string;
  documents: PlaybookDocDisplay[];
  loopEnabled?: boolean;
  maxLoops?: number | null;
}

export interface PlaybooksByAgent {
  agentId: string;
  agentName: string;
  playbooks: PlaybookDisplay[];
}

export function formatPlaybooks(
  playbooks: PlaybookDisplay[],
  agentName?: string,
  folderPath?: string
): string {
  if (playbooks.length === 0) {
    return dim('No playbooks found.');
  }

  const lines: string[] = [];
  const title = agentName
    ? bold(c('cyan', 'PLAYBOOKS')) + dim(` for ${agentName} (${playbooks.length})`)
    : bold(c('cyan', 'PLAYBOOKS')) + dim(` (${playbooks.length})`);
  lines.push(title);

  if (folderPath) {
    lines.push(dim(`  📁 ${folderPath}`));
  }

  lines.push('');

  for (const playbook of playbooks) {
    const name = c('white', playbook.name);
    const docCount = c('green', `${playbook.documents.length} doc${playbook.documents.length !== 1 ? 's' : ''}`);
    const loop = playbook.loopEnabled
      ? c('yellow', ` ↻ loop${playbook.maxLoops ? ` (max ${playbook.maxLoops})` : ''}`)
      : '';
    const id = dim(playbook.id.slice(0, 8));

    lines.push(`  ${name} ${docCount}${loop} ${id}`);

    // Show all documents with details
    for (const doc of playbook.documents) {
      const reset = doc.resetOnCompletion ? c('magenta', ' ↺') : '';
      lines.push(`      ${dim('•')} ${doc.filename}${reset}`);
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// Playbook detail formatting
export interface PlaybookDetailDisplay {
  id: string;
  name: string;
  agentId: string;
  agentName: string;
  folderPath?: string;
  loopEnabled?: boolean;
  maxLoops?: number | null;
  prompt: string;
  documents: {
    filename: string;
    resetOnCompletion: boolean;
    taskCount: number;
    tasks: string[];
  }[];
}

export function formatPlaybookDetail(playbook: PlaybookDetailDisplay): string {
  const lines: string[] = [];

  // Header
  lines.push(bold(c('cyan', 'PLAYBOOK')));
  lines.push('');

  // Basic info
  lines.push(`  ${c('white', 'Name:')}       ${playbook.name}`);
  lines.push(`  ${c('white', 'ID:')}         ${playbook.id}`);
  lines.push(`  ${c('white', 'Agent:')}      ${playbook.agentName} ${dim(`(${playbook.agentId.slice(0, 8)})`)}`);

  if (playbook.folderPath) {
    lines.push(`  ${c('white', 'Folder:')}     ${dim(playbook.folderPath)}`);
  }

  // Loop configuration
  if (playbook.loopEnabled) {
    const loopInfo = playbook.maxLoops ? `max ${playbook.maxLoops}` : '∞';
    lines.push(`  ${c('white', 'Loop:')}       ${c('yellow', `enabled (${loopInfo})`)}`);
  } else {
    lines.push(`  ${c('white', 'Loop:')}       ${dim('disabled')}`);
  }

  lines.push('');

  // Prompt
  lines.push(`  ${c('white', 'Prompt:')}`);
  const promptLines = playbook.prompt.split('\n');
  for (const line of promptLines) {
    lines.push(`    ${dim(line)}`);
  }

  lines.push('');

  // Documents
  const totalTasks = playbook.documents.reduce((sum, d) => sum + d.taskCount, 0);
  lines.push(`  ${c('white', 'Documents:')} ${dim(`(${playbook.documents.length} files, ${totalTasks} pending tasks)`)}`);
  lines.push('');

  for (const doc of playbook.documents) {
    const reset = doc.resetOnCompletion ? c('magenta', ' ↺ reset') : '';
    const taskInfo = doc.taskCount > 0 ? c('green', ` (${doc.taskCount} tasks)`) : dim(' (0 tasks)');
    lines.push(`    ${c('blue', '📄')} ${doc.filename}${taskInfo}${reset}`);

    // Show tasks (up to 5)
    const tasksToShow = doc.tasks.slice(0, 5);
    for (let i = 0; i < tasksToShow.length; i++) {
      const task = truncate(tasksToShow[i], 60);
      lines.push(`        ${dim(`${i + 1}.`)} ${task}`);
    }
    if (doc.tasks.length > 5) {
      lines.push(`        ${dim(`... and ${doc.tasks.length - 5} more`)}`);
    }
  }

  return lines.join('\n');
}

export function formatPlaybooksByAgent(groups: PlaybooksByAgent[]): string {
  // Filter to only agents with playbooks
  const agentsWithPlaybooks = groups.filter((g) => g.playbooks.length > 0);

  if (agentsWithPlaybooks.length === 0) {
    return dim('No playbooks found.');
  }

  const totalPlaybooks = agentsWithPlaybooks.reduce((sum, g) => sum + g.playbooks.length, 0);
  const agentWord = agentsWithPlaybooks.length === 1 ? 'agent' : 'agents';
  const lines: string[] = [];
  lines.push(bold(c('cyan', 'PLAYBOOKS')) + dim(` (${totalPlaybooks} across ${agentsWithPlaybooks.length} ${agentWord})`));
  lines.push('');

  for (const group of agentsWithPlaybooks) {
    // Agent header
    const agentName = c('white', group.agentName);
    const count = dim(`(${group.playbooks.length})`);
    const agentId = dim(group.agentId.slice(0, 8));
    lines.push(`  ${agentName} ${count} ${agentId}`);

    // Playbooks under this agent
    for (const playbook of group.playbooks) {
      const name = playbook.name;
      const docCount = c('green', `${playbook.documents.length} doc${playbook.documents.length !== 1 ? 's' : ''}`);
      const loop = playbook.loopEnabled
        ? c('yellow', ` ↻`)
        : '';
      const id = dim(playbook.id.slice(0, 8));

      lines.push(`      ${name} ${docCount}${loop} ${id}`);
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// Run playbook event formatting
export interface RunEvent {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

export function formatRunEvent(event: RunEvent): string {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const timeStr = dim(`[${time}]`);

  switch (event.type) {
    case 'start':
      return `${timeStr} ${c('cyan', '▶')} ${bold('Starting playbook run')}`;

    case 'document_start': {
      const doc = event.document as string;
      const taskCount = event.taskCount as number;
      return `${timeStr} ${c('blue', '📄')} ${bold(doc)} ${dim(`(${taskCount} tasks)`)}`;
    }

    case 'task_start': {
      const taskIndex = (event.taskIndex as number) + 1;
      const task = truncate(event.task as string || '', 60);
      return `${timeStr}   ${c('yellow', '⏳')} Task ${taskIndex}: ${task}`;
    }

    case 'task_preview': {
      const taskIndex = (event.taskIndex as number) + 1;
      const task = truncate(event.task as string || '', 70);
      return `${timeStr}       ${dim(`${taskIndex}.`)} ${task}`;
    }

    case 'task_complete': {
      const success = event.success as boolean;
      const elapsed = ((event.elapsedMs as number) / 1000).toFixed(1);
      const summary = truncate(event.summary as string || '', 70);
      const icon = success ? c('green', '✓') : c('red', '✗');
      return `${timeStr}   ${icon} ${summary} ${dim(`(${elapsed}s)`)}`;
    }

    case 'document_complete': {
      const completed = event.tasksCompleted as number;
      return `${timeStr} ${c('green', '✓')} Document complete ${dim(`(${completed} tasks)`)}`;
    }

    case 'loop_complete': {
      const loopNum = event.loopNumber as number;
      return `${timeStr} ${c('magenta', '↻')} Loop ${loopNum} complete`;
    }

    case 'complete': {
      const isDryRun = event.dryRun as boolean;
      if (isDryRun) {
        const wouldProcess = event.wouldProcess as number;
        return `\n${timeStr} ${c('cyan', 'ℹ')} ${bold('Dry run complete')} ${dim(`(${wouldProcess} tasks would be processed)`)}`;
      }
      const total = event.totalTasksCompleted as number;
      const elapsed = ((event.totalElapsedMs as number) / 1000).toFixed(1);
      return `\n${timeStr} ${c('green', '✓')} ${bold('Playbook complete')} ${dim(`(${total} tasks in ${elapsed}s)`)}`;
    }

    case 'error': {
      const message = event.message as string;
      return `${timeStr} ${c('red', '✗')} ${c('red', 'Error:')} ${message}`;
    }

    case 'debug': {
      const category = event.category as string;
      const message = event.message as string;
      const categoryColors: Record<string, keyof typeof colors> = {
        config: 'cyan',
        scan: 'blue',
        loop: 'magenta',
        reset: 'yellow',
      };
      const categoryColor = categoryColors[category] || 'gray';
      return `${timeStr} ${c('gray', '🔍')} ${c(categoryColor, `[${category}]`)} ${dim(message)}`;
    }

    default:
      return `${timeStr} ${dim(event.type)}`;
  }
}

// Error formatting
export function formatError(message: string): string {
  return `${c('red', '✗')} ${c('red', 'Error:')} ${message}`;
}

// Success message
export function formatSuccess(message: string): string {
  return `${c('green', '✓')} ${message}`;
}

// Info message
export function formatInfo(message: string): string {
  return `${c('blue', 'ℹ')} ${message}`;
}

// Warning message
export function formatWarning(message: string): string {
  return `${c('yellow', '⚠')} ${message}`;
}
