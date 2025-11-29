import React, { memo, useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import type { Session, Theme } from '../types';

interface ThinkingStatusPillProps {
  sessions: Session[];
  theme: Theme;
  onSessionClick?: (sessionId: string) => void;
}

// ElapsedTimeDisplay - shows time since thinking started
const ElapsedTimeDisplay = memo(({ startTime, textColor }: { startTime: number; textColor: string }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(
    Math.floor((Date.now() - startTime) / 1000)
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <span className="font-mono text-xs" style={{ color: textColor }}>
      {formatTime(elapsedSeconds)}
    </span>
  );
});

ElapsedTimeDisplay.displayName = 'ElapsedTimeDisplay';

// Main component - shows all thinking sessions in a responsive pill
function ThinkingStatusPillInner({ sessions, theme, onSessionClick }: ThinkingStatusPillProps) {
  // Filter to only busy sessions with AI source
  const thinkingSessions = sessions.filter(
    s => s.state === 'busy' && s.busySource === 'ai'
  );

  if (thinkingSessions.length === 0) {
    return null;
  }

  // Calculate total tokens across all thinking sessions
  const totalStats = thinkingSessions.reduce(
    (acc, s) => {
      if (s.usageStats) {
        acc.inputTokens += s.usageStats.inputTokens;
        acc.outputTokens += s.usageStats.outputTokens;
      }
      return acc;
    },
    { inputTokens: 0, outputTokens: 0 }
  );
  const totalTokens = totalStats.inputTokens + totalStats.outputTokens;

  // Get the earliest thinking start time for elapsed display
  const earliestStartTime = Math.min(
    ...thinkingSessions
      .filter(s => s.thinkingStartTime)
      .map(s => s.thinkingStartTime!)
  );

  return (
    <div
      className="flex items-center justify-center gap-2 px-4 py-2 rounded-full mx-auto mb-2 max-w-full overflow-hidden"
      style={{
        backgroundColor: theme.colors.warning + '20',
        border: `1px solid ${theme.colors.warning}40`
      }}
    >
      {/* Pulsing indicator */}
      <Loader2
        className="w-4 h-4 shrink-0 animate-spin"
        style={{ color: theme.colors.warning }}
      />

      {/* Session names - responsive: show names if space, otherwise count */}
      <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
        {thinkingSessions.length <= 2 ? (
          // Show session names for 1-2 sessions
          thinkingSessions.map((session, idx) => (
            <button
              key={session.id}
              onClick={() => onSessionClick?.(session.id)}
              className="text-xs font-medium truncate max-w-[120px] hover:underline cursor-pointer"
              style={{ color: theme.colors.textMain }}
              title={session.name}
            >
              {session.name}
              {idx < thinkingSessions.length - 1 && (
                <span style={{ color: theme.colors.textDim }}>,</span>
              )}
            </button>
          ))
        ) : (
          // Show count for 3+ sessions
          <span className="text-xs font-medium" style={{ color: theme.colors.textMain }}>
            {thinkingSessions.length} sessions
          </span>
        )}
      </div>

      {/* Divider */}
      <div
        className="w-px h-4 shrink-0"
        style={{ backgroundColor: theme.colors.border }}
      />

      {/* Token info - responsive: full → total only → hidden */}
      <div className="flex items-center gap-2 shrink-0 text-xs" style={{ color: theme.colors.textDim }}>
        {/* Full token breakdown - hidden on smaller widths via CSS */}
        <span className="hidden sm:inline">
          In: {totalStats.inputTokens.toLocaleString()}
        </span>
        <span className="hidden sm:inline">
          Out: {totalStats.outputTokens.toLocaleString()}
        </span>
        {/* Total tokens - always visible when we have stats */}
        {totalTokens > 0 && (
          <span className="hidden xs:inline sm:hidden font-medium">
            {totalTokens.toLocaleString()} tokens
          </span>
        )}
        {/* Just show total on very small screens */}
        <span className="inline sm:hidden font-medium" style={{ color: theme.colors.textMain }}>
          {totalTokens > 0 ? totalTokens.toLocaleString() : 'Thinking...'}
        </span>
      </div>

      {/* Elapsed time */}
      {earliestStartTime && isFinite(earliestStartTime) && (
        <>
          <div
            className="w-px h-4 shrink-0 hidden xs:block"
            style={{ backgroundColor: theme.colors.border }}
          />
          <ElapsedTimeDisplay
            startTime={earliestStartTime}
            textColor={theme.colors.textDim}
          />
        </>
      )}
    </div>
  );
}

// Memoized export
export const ThinkingStatusPill = memo(ThinkingStatusPillInner, (prevProps, nextProps) => {
  // Check if thinking sessions have changed
  const prevThinking = prevProps.sessions.filter(s => s.state === 'busy' && s.busySource === 'ai');
  const nextThinking = nextProps.sessions.filter(s => s.state === 'busy' && s.busySource === 'ai');

  if (prevThinking.length !== nextThinking.length) return false;

  // Compare each thinking session's relevant properties
  for (let i = 0; i < prevThinking.length; i++) {
    const prev = prevThinking[i];
    const next = nextThinking[i];
    if (
      prev.id !== next.id ||
      prev.name !== next.name ||
      prev.state !== next.state ||
      prev.thinkingStartTime !== next.thinkingStartTime ||
      prev.usageStats?.inputTokens !== next.usageStats?.inputTokens ||
      prev.usageStats?.outputTokens !== next.usageStats?.outputTokens
    ) {
      return false;
    }
  }

  return prevProps.theme === nextProps.theme;
});

ThinkingStatusPill.displayName = 'ThinkingStatusPill';
