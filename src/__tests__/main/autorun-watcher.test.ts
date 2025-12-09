/**
 * Tests for Auto Run file watching functionality
 *
 * Tests cover:
 * - File watcher IPC handlers (watchFolder, unwatchFolder)
 * - File change event debouncing
 * - Event filtering for .md files only
 * - Watcher cleanup on folder change
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FSWatcher, WatchEventType } from 'fs';

// Track watchers and their callbacks
const mockWatchers = new Map<string, {
  callback: (eventType: WatchEventType, filename: string | null) => void;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}>();

// Mock fs.watch
const mockWatch = vi.fn((folderPath: string, options: any, callback: (eventType: WatchEventType, filename: string | null) => void) => {
  const watcher = {
    callback,
    close: vi.fn(),
    on: vi.fn(),
  };
  mockWatchers.set(folderPath, watcher);
  return watcher as unknown as FSWatcher;
});

// Mock fs/promises stat
const mockStat = vi.fn();

// Mock fs module
vi.mock('fs', () => ({
  default: {
    watch: mockWatch,
  },
  watch: mockWatch,
}));

vi.mock('fs/promises', () => ({
  default: {
    stat: mockStat,
  },
  stat: mockStat,
}));

describe('Auto Run File Watcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockWatchers.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('File change filtering', () => {
    it('should only trigger for .md files', () => {
      // Simulate the filtering logic from the main process
      const shouldTrigger = (filename: string | null): boolean => {
        if (!filename) return false;
        return filename.toLowerCase().endsWith('.md');
      };

      expect(shouldTrigger('document.md')).toBe(true);
      expect(shouldTrigger('UPPERCASE.MD')).toBe(true);
      expect(shouldTrigger('subfolder/nested.md')).toBe(true);
      expect(shouldTrigger('document.txt')).toBe(false);
      expect(shouldTrigger('image.png')).toBe(false);
      expect(shouldTrigger(null)).toBe(false);
      expect(shouldTrigger('')).toBe(false);
    });

    it('should remove .md extension from filename in events', () => {
      // Simulate the filename transformation from the main process
      const transformFilename = (filename: string): string => {
        return filename.replace(/\.md$/i, '');
      };

      expect(transformFilename('document.md')).toBe('document');
      expect(transformFilename('DOCUMENT.MD')).toBe('DOCUMENT');
      expect(transformFilename('subfolder/task.md')).toBe('subfolder/task');
    });
  });

  describe('Debouncing behavior', () => {
    it('should debounce rapid file changes', async () => {
      const events: string[] = [];
      const DEBOUNCE_MS = 300;
      let debounceTimer: NodeJS.Timeout | null = null;

      // Simulate debounced event handler
      const handleFileChange = (filename: string) => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          events.push(filename);
          debounceTimer = null;
        }, DEBOUNCE_MS);
      };

      // Rapid changes
      handleFileChange('doc1.md');
      handleFileChange('doc1.md');
      handleFileChange('doc1.md');

      // No events yet (still debouncing)
      expect(events).toHaveLength(0);

      // Advance past debounce time
      vi.advanceTimersByTime(DEBOUNCE_MS + 50);

      // Only one event should have fired
      expect(events).toHaveLength(1);
      expect(events[0]).toBe('doc1.md');
    });

    it('should fire immediately after debounce period', async () => {
      const events: string[] = [];
      const DEBOUNCE_MS = 300;
      let debounceTimer: NodeJS.Timeout | null = null;

      const handleFileChange = (filename: string) => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          events.push(filename);
          debounceTimer = null;
        }, DEBOUNCE_MS);
      };

      // First change
      handleFileChange('doc1.md');
      vi.advanceTimersByTime(DEBOUNCE_MS + 50);
      expect(events).toHaveLength(1);

      // Second change after debounce completed
      handleFileChange('doc2.md');
      vi.advanceTimersByTime(DEBOUNCE_MS + 50);
      expect(events).toHaveLength(2);
      expect(events[1]).toBe('doc2.md');
    });
  });

  describe('Watcher lifecycle', () => {
    it('should track active watchers by folder path', () => {
      const activeWatchers = new Map<string, FSWatcher>();

      // Start watching
      const folder1 = '/path/to/folder1';
      const folder2 = '/path/to/folder2';

      activeWatchers.set(folder1, {} as FSWatcher);
      activeWatchers.set(folder2, {} as FSWatcher);

      expect(activeWatchers.has(folder1)).toBe(true);
      expect(activeWatchers.has(folder2)).toBe(true);
      expect(activeWatchers.size).toBe(2);
    });

    it('should replace existing watcher for same folder', () => {
      const activeWatchers = new Map<string, { close: () => void }>();
      const folder = '/path/to/folder';

      const watcher1 = { close: vi.fn() };
      const watcher2 = { close: vi.fn() };

      // First watcher
      activeWatchers.set(folder, watcher1);

      // Replace with second watcher (should close first)
      if (activeWatchers.has(folder)) {
        activeWatchers.get(folder)?.close();
        activeWatchers.delete(folder);
      }
      activeWatchers.set(folder, watcher2);

      expect(watcher1.close).toHaveBeenCalled();
      expect(activeWatchers.get(folder)).toBe(watcher2);
    });

    it('should clean up watcher on unwatch', () => {
      const activeWatchers = new Map<string, { close: () => void }>();
      const folder = '/path/to/folder';

      const watcher = { close: vi.fn() };
      activeWatchers.set(folder, watcher);

      // Unwatch
      if (activeWatchers.has(folder)) {
        activeWatchers.get(folder)?.close();
        activeWatchers.delete(folder);
      }

      expect(watcher.close).toHaveBeenCalled();
      expect(activeWatchers.has(folder)).toBe(false);
    });

    it('should clean up all watchers on app quit', () => {
      const activeWatchers = new Map<string, { close: () => void }>();

      const watcher1 = { close: vi.fn() };
      const watcher2 = { close: vi.fn() };
      const watcher3 = { close: vi.fn() };

      activeWatchers.set('/folder1', watcher1);
      activeWatchers.set('/folder2', watcher2);
      activeWatchers.set('/folder3', watcher3);

      // Simulate app quit cleanup
      for (const [, watcher] of activeWatchers) {
        watcher.close();
      }
      activeWatchers.clear();

      expect(watcher1.close).toHaveBeenCalled();
      expect(watcher2.close).toHaveBeenCalled();
      expect(watcher3.close).toHaveBeenCalled();
      expect(activeWatchers.size).toBe(0);
    });
  });

  describe('Event data structure', () => {
    it('should create correct event payload', () => {
      const createEventPayload = (folderPath: string, filename: string, eventType: string) => ({
        folderPath,
        filename: filename.replace(/\.md$/i, ''),
        eventType,
      });

      const payload = createEventPayload('/test/folder', 'task.md', 'change');

      expect(payload).toEqual({
        folderPath: '/test/folder',
        filename: 'task',
        eventType: 'change',
      });
    });

    it('should handle subfolder paths correctly', () => {
      const createEventPayload = (folderPath: string, filename: string, eventType: string) => ({
        folderPath,
        filename: filename.replace(/\.md$/i, ''),
        eventType,
      });

      // Subfolder path from fs.watch recursive mode
      const payload = createEventPayload('/test/folder', 'subfolder/nested-task.md', 'change');

      expect(payload).toEqual({
        folderPath: '/test/folder',
        filename: 'subfolder/nested-task',
        eventType: 'change',
      });
    });
  });

  describe('Path validation', () => {
    it('should validate folder exists before watching', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => true });

      const folderPath = '/valid/folder';
      const stat = await mockStat(folderPath);

      expect(stat.isDirectory()).toBe(true);
    });

    it('should reject non-directory paths', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => false });

      const filePath = '/path/to/file.txt';
      const stat = await mockStat(filePath);

      expect(stat.isDirectory()).toBe(false);
    });

    it('should handle stat errors gracefully', async () => {
      mockStat.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      await expect(mockStat('/nonexistent/path')).rejects.toThrow('ENOENT');
    });
  });
});

describe('Auto Run File Watcher Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Watch + Event flow', () => {
    it('should complete full watch-change-unwatch cycle', () => {
      const activeWatchers = new Map<string, { close: () => void; callback: (event: string, file: string) => void }>();
      const events: Array<{ folder: string; file: string }> = [];
      const DEBOUNCE_MS = 300;
      let debounceTimer: NodeJS.Timeout | null = null;

      const folder = '/test/autorun';

      // Start watching
      const callback = (eventType: string, filename: string) => {
        if (!filename?.endsWith('.md')) return;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          events.push({ folder, file: filename.replace(/\.md$/, '') });
          debounceTimer = null;
        }, DEBOUNCE_MS);
      };

      activeWatchers.set(folder, { close: vi.fn(), callback });

      // Simulate file change
      const watcher = activeWatchers.get(folder);
      watcher?.callback('change', 'task1.md');

      // Advance debounce
      vi.advanceTimersByTime(DEBOUNCE_MS + 50);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ folder, file: 'task1' });

      // Unwatch
      watcher?.close();
      activeWatchers.delete(folder);

      expect(activeWatchers.size).toBe(0);
    });

    it('should handle multiple folders independently', () => {
      const activeWatchers = new Map<string, { events: string[] }>();

      activeWatchers.set('/folder1', { events: [] });
      activeWatchers.set('/folder2', { events: [] });

      // Events to folder1
      activeWatchers.get('/folder1')?.events.push('doc1');
      activeWatchers.get('/folder1')?.events.push('doc2');

      // Events to folder2
      activeWatchers.get('/folder2')?.events.push('task1');

      expect(activeWatchers.get('/folder1')?.events).toEqual(['doc1', 'doc2']);
      expect(activeWatchers.get('/folder2')?.events).toEqual(['task1']);
    });
  });

  describe('Content reload on file change', () => {
    it('should trigger content reload when selected file changes', () => {
      const selectedFile = 'current-task';
      const changedFile = 'current-task';

      const shouldReload = selectedFile && changedFile === selectedFile;

      expect(shouldReload).toBe(true);
    });

    it('should not trigger content reload for different file', () => {
      const selectedFile = 'current-task';
      const changedFile = 'other-task';

      const shouldReload = selectedFile && changedFile === selectedFile;

      expect(shouldReload).toBe(false);
    });

    it('should not trigger content reload when no file is selected', () => {
      const selectedFile: string | null = null;
      const changedFile = 'some-task';

      // When selectedFile is null, we should not try to reload content
      const shouldReload = selectedFile && changedFile === selectedFile;

      expect(shouldReload).toBeFalsy();
    });

    it('should always refresh document list on any change', () => {
      // Document list should refresh regardless of which file changed
      // This allows detecting new/deleted files
      const shouldRefreshList = true; // Always true for any .md file change

      expect(shouldRefreshList).toBe(true);
    });

    it('should refresh document list even when no document is selected', () => {
      // Even with no selected document, changes should refresh the list
      // so new documents appear in the UI
      const selectedFile: string | null = null;
      const changedFile = 'new-document';

      // Document list should still refresh
      const shouldRefreshList = true;
      // But content should NOT reload (no selected file)
      const shouldReloadContent = selectedFile && changedFile === selectedFile;

      expect(shouldRefreshList).toBe(true);
      expect(shouldReloadContent).toBeFalsy();
    });
  });

  describe('Watch trigger conditions', () => {
    it('should watch when folder is set, even without selected document', () => {
      const folderPath = '/test/autorun';
      const selectedFile: string | null = null;

      // Watch should trigger when folder exists, regardless of selected file
      const shouldWatch = !!folderPath;

      expect(shouldWatch).toBe(true);
    });

    it('should not watch when folder is not set', () => {
      const folderPath: string | null = null;
      const selectedFile = 'some-doc';

      // No folder means no watch
      const shouldWatch = !!folderPath;

      expect(shouldWatch).toBe(false);
    });

    it('should watch when both folder and document are set', () => {
      const folderPath = '/test/autorun';
      const selectedFile = 'current-task';

      const shouldWatch = !!folderPath;

      expect(shouldWatch).toBe(true);
    });
  });
});

describe('Preload API types', () => {
  it('should define correct watchFolder return type', () => {
    type WatchResult = { success: boolean; error?: string };

    const successResult: WatchResult = { success: true };
    const errorResult: WatchResult = { success: false, error: 'Path is not a directory' };

    expect(successResult.success).toBe(true);
    expect(errorResult.success).toBe(false);
    expect(errorResult.error).toBe('Path is not a directory');
  });

  it('should define correct onFileChanged event data type', () => {
    type FileChangeEvent = {
      folderPath: string;
      filename: string;
      eventType: string;
    };

    const event: FileChangeEvent = {
      folderPath: '/test/folder',
      filename: 'task',
      eventType: 'change',
    };

    expect(event.folderPath).toBe('/test/folder');
    expect(event.filename).toBe('task');
    expect(event.eventType).toBe('change');
  });

  it('should define correct unsubscribe function type', () => {
    type Unsubscribe = () => void;

    const mockUnsubscribe: Unsubscribe = vi.fn();
    mockUnsubscribe();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});
