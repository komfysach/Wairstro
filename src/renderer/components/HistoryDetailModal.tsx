import React, { useEffect, useRef, useState } from 'react';
import { X, Bot, User, ExternalLink, Copy, Check, CheckCircle, XCircle, Trash2 } from 'lucide-react';
import type { Theme, HistoryEntry } from '../types';
import { useLayerStack } from '../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';

interface HistoryDetailModalProps {
  theme: Theme;
  entry: HistoryEntry;
  onClose: () => void;
  onJumpToClaudeSession?: (claudeSessionId: string) => void;
  onDelete?: (entryId: string) => void;
}

// Get context bar color based on usage percentage
const getContextColor = (usage: number, theme: Theme) => {
  if (usage >= 90) return theme.colors.error;
  if (usage >= 70) return theme.colors.warning;
  return theme.colors.success;
};

export function HistoryDetailModal({
  theme,
  entry,
  onClose,
  onJumpToClaudeSession,
  onDelete
}: HistoryDetailModalProps) {
  const { registerLayer, unregisterLayer, updateLayerHandler } = useLayerStack();
  const layerIdRef = useRef<string>();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [copiedSessionId, setCopiedSessionId] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Register layer on mount
  useEffect(() => {
    const id = registerLayer({
      type: 'modal',
      priority: MODAL_PRIORITIES.CONFIRM, // Use same priority as confirm modal
      onEscape: () => {
        onCloseRef.current();
      }
    });
    layerIdRef.current = id;

    return () => {
      if (layerIdRef.current) {
        unregisterLayer(layerIdRef.current);
      }
    };
  }, [registerLayer, unregisterLayer]);

  // Keep escape handler up to date
  useEffect(() => {
    if (layerIdRef.current) {
      updateLayerHandler(layerIdRef.current, () => {
        onCloseRef.current();
      });
    }
  }, [onClose, updateLayerHandler]);

  // Format timestamp
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Get pill color based on type
  const getPillColor = () => {
    if (entry.type === 'AUTO') {
      return { bg: theme.colors.warning + '20', text: theme.colors.warning, border: theme.colors.warning + '40' };
    }
    return { bg: theme.colors.accent + '20', text: theme.colors.accent, border: theme.colors.accent + '40' };
  };

  const colors = getPillColor();
  const Icon = entry.type === 'AUTO' ? Bot : User;

  // Clean up the response for display - remove ANSI codes
  const rawResponse = entry.fullResponse || entry.summary || '';
  const cleanResponse = rawResponse.replace(/\x1b\[[0-9;]*m/g, ''); // Remove ANSI codes

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[9999]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-3xl max-h-[80vh] overflow-hidden rounded-lg border shadow-2xl flex flex-col"
        style={{
          backgroundColor: theme.colors.bgSidebar,
          borderColor: theme.colors.border
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b shrink-0"
          style={{ borderColor: theme.colors.border }}
        >
          <div className="flex items-center gap-3">
            {/* Success/Failure Indicator for AUTO entries */}
            {entry.type === 'AUTO' && entry.success !== undefined && (
              <span
                className="flex items-center justify-center w-6 h-6 rounded-full"
                style={{
                  backgroundColor: entry.success ? theme.colors.success + '20' : theme.colors.error + '20',
                  border: `1px solid ${entry.success ? theme.colors.success + '40' : theme.colors.error + '40'}`
                }}
                title={entry.success ? 'Task completed successfully' : 'Task failed'}
              >
                {entry.success ? (
                  <CheckCircle className="w-4 h-4" style={{ color: theme.colors.success }} />
                ) : (
                  <XCircle className="w-4 h-4" style={{ color: theme.colors.error }} />
                )}
              </span>
            )}

            {/* Type Pill */}
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
              style={{
                backgroundColor: colors.bg,
                color: colors.text,
                border: `1px solid ${colors.border}`
              }}
            >
              <Icon className="w-2.5 h-2.5" />
              {entry.type}
            </span>

            {/* Session ID Octet - copyable with optional jump */}
            {entry.claudeSessionId && (
              <div className="flex items-center gap-1">
                {/* Copy button */}
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(entry.claudeSessionId!);
                    setCopiedSessionId(true);
                    setTimeout(() => setCopiedSessionId(false), 2000);
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase transition-colors hover:opacity-80"
                  style={{
                    backgroundColor: theme.colors.accent + '20',
                    color: theme.colors.accent,
                    border: `1px solid ${theme.colors.accent}40`
                  }}
                  title={`Copy session ID: ${entry.claudeSessionId}`}
                >
                  {entry.claudeSessionId.split('-')[0].toUpperCase()}
                  {copiedSessionId ? (
                    <Check className="w-2.5 h-2.5" />
                  ) : (
                    <Copy className="w-2.5 h-2.5" />
                  )}
                </button>
                {/* Jump button */}
                {onJumpToClaudeSession && (
                  <button
                    onClick={() => {
                      onJumpToClaudeSession(entry.claudeSessionId!);
                      onClose();
                    }}
                    className="p-1 rounded-full transition-colors hover:opacity-80"
                    style={{
                      backgroundColor: theme.colors.accent + '20',
                      color: theme.colors.accent,
                      border: `1px solid ${theme.colors.accent}40`
                    }}
                    title={`Jump to session ${entry.claudeSessionId}`}
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            )}

            {/* Timestamp */}
            <span className="text-xs" style={{ color: theme.colors.textDim }}>
              {formatTime(entry.timestamp)}
            </span>
          </div>

          {/* Right side widgets */}
          <div className="flex items-center gap-3">
            {/* Cost Tracker - styled as pill */}
            {entry.usageStats && entry.usageStats.totalCostUsd > 0 && (
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full border border-green-500/30 text-green-500 bg-green-500/10">
                ${entry.usageStats.totalCostUsd.toFixed(2)}
              </span>
            )}

            {/* Context Window Widget */}
            {entry.contextUsage !== undefined && (
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-bold uppercase" style={{ color: theme.colors.textDim }}>Context Window</span>
                <div className="w-24 h-1.5 rounded-full mt-1 overflow-hidden" style={{ backgroundColor: theme.colors.border }}>
                  <div
                    className="h-full transition-all duration-500 ease-out"
                    style={{
                      width: `${entry.contextUsage}%`,
                      backgroundColor: getContextColor(entry.contextUsage, theme)
                    }}
                  />
                </div>
              </div>
            )}

            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" style={{ color: theme.colors.textDim }} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div
          className="flex-1 overflow-y-auto px-6 py-5 scrollbar-thin"
          style={{ color: theme.colors.textMain }}
        >
          <pre
            className="whitespace-pre-wrap font-mono text-sm leading-relaxed"
            style={{ color: theme.colors.textMain }}
          >
            {cleanResponse}
          </pre>
        </div>

        {/* Footer */}
        <div
          className="flex justify-between px-6 py-4 border-t shrink-0"
          style={{ borderColor: theme.colors.border }}
        >
          {/* Delete button */}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors hover:opacity-90"
            style={{
              backgroundColor: theme.colors.error + '20',
              color: theme.colors.error,
              border: `1px solid ${theme.colors.error}40`
            }}
            title="Delete this history entry"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm font-medium transition-colors hover:opacity-90"
            style={{
              backgroundColor: theme.colors.accent,
              color: 'white'
            }}
          >
            Close
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 flex items-center justify-center z-[10001]"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative w-[400px] border rounded-lg shadow-2xl overflow-hidden"
            style={{
              backgroundColor: theme.colors.bgSidebar,
              borderColor: theme.colors.border
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="p-4 border-b flex items-center justify-between"
              style={{ borderColor: theme.colors.border }}
            >
              <h2 className="text-sm font-bold" style={{ color: theme.colors.textMain }}>
                Delete History Entry
              </h2>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                style={{ color: theme.colors.textDim }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm leading-relaxed" style={{ color: theme.colors.textMain }}>
                Are you sure you want to delete this {entry.type === 'AUTO' ? 'auto' : 'user'} history entry? This action cannot be undone.
              </p>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 rounded border hover:bg-white/5 transition-colors"
                  style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (onDelete) {
                      onDelete(entry.id);
                    }
                    setShowDeleteConfirm(false);
                    onClose();
                  }}
                  className="px-4 py-2 rounded text-white"
                  style={{ backgroundColor: theme.colors.error }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
