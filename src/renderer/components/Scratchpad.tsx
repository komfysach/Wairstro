import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Eye, Edit, Play, Square, HelpCircle, Loader2 } from 'lucide-react';
import type { BatchRunState } from '../types';
import { AutoRunnerHelpModal } from './AutoRunnerHelpModal';
import { MermaidRenderer } from './MermaidRenderer';

interface ScratchpadProps {
  content: string;
  onChange: (content: string) => void;
  theme: any;
  initialMode?: 'edit' | 'preview';
  initialCursorPosition?: number;
  initialEditScrollPos?: number;
  initialPreviewScrollPos?: number;
  onStateChange?: (state: {
    mode: 'edit' | 'preview';
    cursorPosition: number;
    editScrollPos: number;
    previewScrollPos: number;
  }) => void;
  // Batch processing props
  batchRunState?: BatchRunState;
  onOpenBatchRunner?: () => void;
  onStopBatchRun?: () => void;
}

export function Scratchpad({
  content,
  onChange,
  theme,
  initialMode = 'edit',
  initialCursorPosition = 0,
  initialEditScrollPos = 0,
  initialPreviewScrollPos = 0,
  onStateChange,
  batchRunState,
  onOpenBatchRunner,
  onStopBatchRun
}: ScratchpadProps) {
  const isLocked = batchRunState?.isRunning || false;
  const isStopping = batchRunState?.isStopping || false;
  const [mode, setMode] = useState<'edit' | 'preview'>(initialMode);
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Restore cursor and scroll positions when component mounts
  useEffect(() => {
    if (textareaRef.current && initialCursorPosition > 0) {
      textareaRef.current.setSelectionRange(initialCursorPosition, initialCursorPosition);
      textareaRef.current.scrollTop = initialEditScrollPos;
    }
    if (previewRef.current && initialPreviewScrollPos > 0) {
      previewRef.current.scrollTop = initialPreviewScrollPos;
    }
  }, []);

  // Notify parent when mode changes
  const toggleMode = () => {
    const newMode = mode === 'edit' ? 'preview' : 'edit';
    setMode(newMode);

    if (onStateChange) {
      onStateChange({
        mode: newMode,
        cursorPosition: textareaRef.current?.selectionStart || 0,
        editScrollPos: textareaRef.current?.scrollTop || 0,
        previewScrollPos: previewRef.current?.scrollTop || 0
      });
    }
  };

  // Auto-focus the active element after mode change
  useEffect(() => {
    if (mode === 'edit' && textareaRef.current) {
      textareaRef.current.focus();
    } else if (mode === 'preview' && previewRef.current) {
      previewRef.current.focus();
    }
  }, [mode]);

  // Save cursor position and scroll position when they change
  const handleCursorOrScrollChange = () => {
    if (onStateChange && textareaRef.current) {
      onStateChange({
        mode,
        cursorPosition: textareaRef.current.selectionStart,
        editScrollPos: textareaRef.current.scrollTop,
        previewScrollPos: previewRef.current?.scrollTop || 0
      });
    }
  };

  const handlePreviewScroll = () => {
    if (onStateChange && previewRef.current) {
      onStateChange({
        mode,
        cursorPosition: textareaRef.current?.selectionStart || 0,
        editScrollPos: textareaRef.current?.scrollTop || 0,
        previewScrollPos: previewRef.current.scrollTop
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Command-E to toggle between edit and preview
    if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
      e.preventDefault();
      e.stopPropagation();
      toggleMode();
      return;
    }

    // Command-L to insert a markdown checkbox
    if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
      e.preventDefault();
      e.stopPropagation();
      const textarea = e.currentTarget;
      const cursorPos = textarea.selectionStart;
      const textBeforeCursor = content.substring(0, cursorPos);
      const textAfterCursor = content.substring(cursorPos);

      // Check if we're at the start of a line or have text before
      const lastNewline = textBeforeCursor.lastIndexOf('\n');
      const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
      const textOnCurrentLine = textBeforeCursor.substring(lineStart);

      let newContent: string;
      let newCursorPos: number;

      if (textOnCurrentLine.length === 0) {
        // At start of line, just insert checkbox
        newContent = textBeforeCursor + '- [ ] ' + textAfterCursor;
        newCursorPos = cursorPos + 6; // "- [ ] " is 6 chars
      } else {
        // In middle of line, insert newline then checkbox
        newContent = textBeforeCursor + '\n- [ ] ' + textAfterCursor;
        newCursorPos = cursorPos + 7; // "\n- [ ] " is 7 chars
      }

      onChange(newContent);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      const textarea = e.currentTarget;
      const cursorPos = textarea.selectionStart;
      const textBeforeCursor = content.substring(0, cursorPos);
      const textAfterCursor = content.substring(cursorPos);
      const currentLineStart = textBeforeCursor.lastIndexOf('\n') + 1;
      const currentLine = textBeforeCursor.substring(currentLineStart);

      // Check for list patterns
      const unorderedListMatch = currentLine.match(/^(\s*)([-*])\s+/);
      const orderedListMatch = currentLine.match(/^(\s*)(\d+)\.\s+/);
      const taskListMatch = currentLine.match(/^(\s*)- \[([ x])\]\s+/);

      if (taskListMatch) {
        // Task list: continue with unchecked checkbox
        const indent = taskListMatch[1];
        e.preventDefault();
        const newContent = textBeforeCursor + '\n' + indent + '- [ ] ' + textAfterCursor;
        onChange(newContent);
        setTimeout(() => {
          if (textareaRef.current) {
            const newPos = cursorPos + indent.length + 7; // "\n" + indent + "- [ ] "
            textareaRef.current.setSelectionRange(newPos, newPos);
          }
        }, 0);
      } else if (unorderedListMatch) {
        // Unordered list: continue with same marker
        const indent = unorderedListMatch[1];
        const marker = unorderedListMatch[2];
        e.preventDefault();
        const newContent = textBeforeCursor + '\n' + indent + marker + ' ' + textAfterCursor;
        onChange(newContent);
        setTimeout(() => {
          if (textareaRef.current) {
            const newPos = cursorPos + indent.length + 3; // "\n" + indent + marker + " "
            textareaRef.current.setSelectionRange(newPos, newPos);
          }
        }, 0);
      } else if (orderedListMatch) {
        // Ordered list: increment number
        const indent = orderedListMatch[1];
        const num = parseInt(orderedListMatch[2]);
        e.preventDefault();
        const newContent = textBeforeCursor + '\n' + indent + (num + 1) + '. ' + textAfterCursor;
        onChange(newContent);
        setTimeout(() => {
          if (textareaRef.current) {
            const newPos = cursorPos + indent.length + (num + 1).toString().length + 3; // "\n" + indent + num + ". "
            textareaRef.current.setSelectionRange(newPos, newPos);
          }
        }, 0);
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className="h-full flex flex-col outline-none"
      tabIndex={-1}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
          e.preventDefault();
          toggleMode();
        }
      }}
    >
      {/* Mode Toggle */}
      <div className="flex gap-2 mb-3 justify-center pt-2">
        <button
          onClick={() => !isLocked && setMode('edit')}
          disabled={isLocked}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors ${
            mode === 'edit' ? 'font-semibold' : ''
          } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
          style={{
            backgroundColor: mode === 'edit' ? theme.colors.bgActivity : 'transparent',
            color: mode === 'edit' ? theme.colors.textMain : theme.colors.textDim,
            border: `1px solid ${mode === 'edit' ? theme.colors.accent : theme.colors.border}`
          }}
        >
          <Edit className="w-3.5 h-3.5" />
          Edit
        </button>
        <button
          onClick={() => !isLocked && setMode('preview')}
          disabled={isLocked}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors ${
            mode === 'preview' ? 'font-semibold' : ''
          } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
          style={{
            backgroundColor: mode === 'preview' ? theme.colors.bgActivity : 'transparent',
            color: mode === 'preview' ? theme.colors.textMain : theme.colors.textDim,
            border: `1px solid ${mode === 'preview' ? theme.colors.accent : theme.colors.border}`
          }}
        >
          <Eye className="w-3.5 h-3.5" />
          Preview
        </button>
        {/* Help button */}
        <button
          onClick={() => setHelpModalOpen(true)}
          className="flex items-center justify-center w-8 h-8 rounded-full transition-colors hover:bg-white/10"
          style={{ color: theme.colors.textDim }}
          title="Learn about Auto Runner"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
        {/* Run / Stop button */}
        {isLocked ? (
          <button
            onClick={onStopBatchRun}
            disabled={isStopping}
            className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors font-semibold ${isStopping ? 'opacity-50 cursor-not-allowed' : ''}`}
            style={{
              backgroundColor: theme.colors.error,
              color: 'white',
              border: `1px solid ${theme.colors.error}`
            }}
            title={isStopping ? 'Stopping after current task...' : 'Stop batch run'}
          >
            {isStopping ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Square className="w-3.5 h-3.5" />
            )}
            {isStopping ? 'Stopping...' : 'Stop'}
          </button>
        ) : (
          <button
            onClick={onOpenBatchRunner}
            className="flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors hover:opacity-90"
            style={{
              backgroundColor: theme.colors.accent,
              color: 'white',
              border: `1px solid ${theme.colors.accent}`
            }}
            title="Run batch processing on scratchpad tasks"
          >
            <Play className="w-3.5 h-3.5" />
            Run
          </button>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden">
        {mode === 'edit' ? (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => !isLocked && onChange(e.target.value)}
            onKeyDown={!isLocked ? handleKeyDown : undefined}
            onKeyUp={handleCursorOrScrollChange}
            onClick={handleCursorOrScrollChange}
            onScroll={handleCursorOrScrollChange}
            placeholder="Write your notes in markdown..."
            readOnly={isLocked}
            className={`w-full h-full border rounded p-4 bg-transparent outline-none resize-none font-mono text-sm ${isLocked ? 'cursor-not-allowed opacity-70' : ''}`}
            style={{
              borderColor: isLocked ? theme.colors.warning : theme.colors.border,
              color: theme.colors.textMain,
              backgroundColor: isLocked ? theme.colors.bgActivity + '30' : 'transparent'
            }}
          />
        ) : (
          <div
            ref={previewRef}
            className="h-full border rounded p-4 overflow-y-auto prose prose-sm max-w-none outline-none scrollbar-thin"
            tabIndex={0}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
                e.preventDefault();
                e.stopPropagation();
                toggleMode();
              }
            }}
            onScroll={handlePreviewScroll}
            style={{
              borderColor: theme.colors.border,
              color: theme.colors.textMain
            }}
          >
            <style>{`
              .prose h1 { color: ${theme.colors.textMain}; font-size: 2em; font-weight: bold; margin: 0.67em 0; }
              .prose h2 { color: ${theme.colors.textMain}; font-size: 1.5em; font-weight: bold; margin: 0.75em 0; }
              .prose h3 { color: ${theme.colors.textMain}; font-size: 1.17em; font-weight: bold; margin: 0.83em 0; }
              .prose h4 { color: ${theme.colors.textMain}; font-size: 1em; font-weight: bold; margin: 1em 0; }
              .prose h5 { color: ${theme.colors.textMain}; font-size: 0.83em; font-weight: bold; margin: 1.17em 0; }
              .prose h6 { color: ${theme.colors.textMain}; font-size: 0.67em; font-weight: bold; margin: 1.33em 0; }
              .prose p { color: ${theme.colors.textMain}; margin: 0.5em 0; }
              .prose ul, .prose ol { color: ${theme.colors.textMain}; margin: 0.5em 0; padding-left: 1.5em; }
              .prose li { margin: 0.25em 0; }
              .prose code { background-color: ${theme.colors.bgActivity}; color: ${theme.colors.textMain}; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
              .prose pre { background-color: ${theme.colors.bgActivity}; color: ${theme.colors.textMain}; padding: 1em; border-radius: 6px; overflow-x: auto; }
              .prose pre code { background: none; padding: 0; }
              .prose blockquote { border-left: 4px solid ${theme.colors.border}; padding-left: 1em; margin: 0.5em 0; color: ${theme.colors.textDim}; }
              .prose a { color: ${theme.colors.accent}; text-decoration: underline; }
              .prose hr { border: none; border-top: 2px solid ${theme.colors.border}; margin: 1em 0; }
              .prose table { border-collapse: collapse; width: 100%; margin: 0.5em 0; }
              .prose th, .prose td { border: 1px solid ${theme.colors.border}; padding: 0.5em; text-align: left; }
              .prose th { background-color: ${theme.colors.bgActivity}; font-weight: bold; }
              .prose strong { font-weight: bold; }
              .prose em { font-style: italic; }
              .prose input[type="checkbox"] {
                appearance: none;
                -webkit-appearance: none;
                width: 16px;
                height: 16px;
                border: 2px solid ${theme.colors.accent};
                border-radius: 3px;
                background-color: transparent;
                cursor: pointer;
                vertical-align: middle;
                margin-right: 8px;
                position: relative;
              }
              .prose input[type="checkbox"]:checked {
                background-color: ${theme.colors.accent};
                border-color: ${theme.colors.accent};
              }
              .prose input[type="checkbox"]:checked::after {
                content: '';
                position: absolute;
                left: 4px;
                top: 1px;
                width: 5px;
                height: 9px;
                border: solid ${theme.colors.bgMain};
                border-width: 0 2px 2px 0;
                transform: rotate(45deg);
              }
              .prose input[type="checkbox"]:hover {
                border-color: ${theme.colors.highlight};
                box-shadow: 0 0 4px ${theme.colors.accent}40;
              }
              .prose li:has(> input[type="checkbox"]) {
                list-style-type: none;
                margin-left: -1.5em;
              }
            `}</style>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code: ({ node, inline, className, children, ...props }: any) => {
                  const match = (className || '').match(/language-(\w+)/);
                  const language = match ? match[1] : 'text';
                  const codeContent = String(children).replace(/\n$/, '');

                  // Handle mermaid code blocks
                  if (!inline && language === 'mermaid') {
                    return <MermaidRenderer chart={codeContent} theme={theme} />;
                  }

                  return !inline && match ? (
                    <SyntaxHighlighter
                      language={language}
                      style={vscDarkPlus}
                      customStyle={{
                        margin: '0.5em 0',
                        padding: '1em',
                        background: theme.colors.bgActivity,
                        fontSize: '0.9em',
                        borderRadius: '6px',
                      }}
                      PreTag="div"
                    >
                      {codeContent}
                    </SyntaxHighlighter>
                  ) : (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                }
              }}
            >
              {content || '*No content yet. Switch to Edit mode to start writing.*'}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {/* Help Modal */}
      {helpModalOpen && (
        <AutoRunnerHelpModal
          theme={theme}
          onClose={() => setHelpModalOpen(false)}
        />
      )}
    </div>
  );
}
