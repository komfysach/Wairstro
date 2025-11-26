export interface SlashCommand {
  command: string;
  description: string;
  execute: (context: SlashCommandContext) => void;
}

export interface SlashCommandContext {
  activeSessionId: string;
  sessions: any[];
  setSessions: (sessions: any[] | ((prev: any[]) => any[])) => void;
  currentMode: 'ai' | 'terminal';
  // Optional properties for file tree navigation
  setRightPanelOpen?: (open: boolean) => void;
  setActiveRightTab?: (tab: string) => void;
  setActiveFocus?: (focus: 'sidebar' | 'main' | 'right') => void;
  setSelectedFileIndex?: (index: number) => void;
  fileTreeRef?: React.RefObject<HTMLDivElement>;
}

export const slashCommands: SlashCommand[] = [
  {
    command: '/clear',
    description: 'Clear the output history',
    execute: (context: SlashCommandContext) => {
      const { activeSessionId, sessions, setSessions, currentMode } = context;

      // Use fallback to first session if activeSessionId is empty
      const actualActiveId = activeSessionId || (sessions.length > 0 ? sessions[0].id : '');
      if (!actualActiveId) return;

      const targetLogKey = currentMode === 'ai' ? 'aiLogs' : 'shellLogs';

      setSessions(prev => prev.map(s => {
        if (s.id !== actualActiveId) return s;
        return {
          ...s,
          [targetLogKey]: []
        };
      }));
    }
  },
  {
    command: '/jump',
    description: 'Jump to CWD in file tree',
    execute: (context: SlashCommandContext) => {
      const { activeSessionId, sessions, setSessions, setRightPanelOpen, setActiveRightTab, setActiveFocus } = context;

      // Use fallback to first session if activeSessionId is empty
      const actualActiveId = activeSessionId || (sessions.length > 0 ? sessions[0].id : '');

      // Find active session
      const activeSession = sessions.find(s => s.id === actualActiveId);
      if (!activeSession) return;

      // Get the current working directory (use shellCwd for terminal mode, cwd otherwise)
      const targetDir = activeSession.shellCwd || activeSession.cwd;

      // Open right panel, switch to files tab, and focus on file tree
      if (setRightPanelOpen) setRightPanelOpen(true);
      if (setActiveRightTab) setActiveRightTab('files');
      if (setActiveFocus) setActiveFocus('right');

      // Calculate the relative path from session cwd to target directory
      const relativePath = targetDir.replace(activeSession.cwd, '').replace(/^\//, '');

      // Expand all parent folders in the path and set pendingJumpPath
      setSessions(prev => prev.map(s => {
        if (s.id !== actualActiveId) return s;

        // Build list of relative parent paths to expand
        const pathParts = relativePath.split('/').filter(Boolean);
        const expandPaths: string[] = [];

        let currentPath = '';
        for (const part of pathParts) {
          currentPath = currentPath ? currentPath + '/' + part : part;
          expandPaths.push(currentPath);
        }

        // Add all parent paths to expanded list
        const newExpanded = new Set([...(s.fileExplorerExpanded || []), ...expandPaths]);

        return {
          ...s,
          fileExplorerExpanded: Array.from(newExpanded),
          // Set pending jump path - will be processed by App.tsx once flatFileList updates
          pendingJumpPath: relativePath || ''
        };
      }));
    }
  }
];
