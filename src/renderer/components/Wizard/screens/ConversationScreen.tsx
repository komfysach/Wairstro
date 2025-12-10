/**
 * ConversationScreen.tsx
 *
 * Third screen of the onboarding wizard - AI-driven conversation
 * for project discovery with confidence meter and structured output parsing.
 *
 * Features:
 * - AI Terminal-like interface for familiarity
 * - Confidence progress bar (0-100%, red to yellow to green)
 * - Conversation display area with message history
 * - Input field at bottom for user responses
 * - "Let's get started!" button when ready=true and confidence>80
 * - Structured output parsing (confidence, ready, message)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Theme } from '../../../types';
import { useWizard, type WizardMessage } from '../WizardContext';
import {
  getConfidenceColor,
  getInitialQuestion,
  READY_CONFIDENCE_THRESHOLD,
} from '../services/wizardPrompts';
import {
  conversationManager,
  createUserMessage,
  createAssistantMessage,
} from '../services/conversationManager';

interface ConversationScreenProps {
  theme: Theme;
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * ConfidenceMeter - Horizontal progress bar with gradient fill
 */
function ConfidenceMeter({
  confidence,
  theme,
}: {
  confidence: number;
  theme: Theme;
}): JSX.Element {
  const clampedConfidence = Math.max(0, Math.min(100, confidence));
  const confidenceColor = getConfidenceColor(clampedConfidence);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
          Project Understanding
        </span>
        <span
          className="text-sm font-bold"
          style={{ color: confidenceColor }}
        >
          {clampedConfidence}%
        </span>
      </div>
      <div
        className="w-full h-2 rounded-full overflow-hidden"
        style={{ backgroundColor: theme.colors.border }}
      >
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${clampedConfidence}%`,
            backgroundColor: confidenceColor,
            boxShadow: `0 0 8px ${confidenceColor}40`,
          }}
        />
      </div>
      {clampedConfidence >= READY_CONFIDENCE_THRESHOLD && (
        <p
          className="text-xs mt-1 text-center"
          style={{ color: theme.colors.success }}
        >
          Ready to create your action plan!
        </p>
      )}
    </div>
  );
}

/**
 * MessageBubble - Individual conversation message display
 */
function MessageBubble({
  message,
  theme,
}: {
  message: WizardMessage;
  theme: Theme;
}): JSX.Element {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}
    >
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isUser ? 'rounded-br-none' : 'rounded-bl-none'
        }`}
        style={{
          backgroundColor: isUser
            ? theme.colors.accent
            : isSystem
            ? `${theme.colors.warning}20`
            : theme.colors.bgActivity,
          color: isUser ? theme.colors.accentForeground : theme.colors.textMain,
        }}
      >
        {/* Role indicator for non-user messages */}
        {!isUser && (
          <div
            className="text-xs font-medium mb-1 flex items-center gap-2"
            style={{ color: isSystem ? theme.colors.warning : theme.colors.accent }}
          >
            <span>{isSystem ? '🎼 System' : '🎼 Maestro'}</span>
            {message.confidence !== undefined && (
              <span
                className="text-xs px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: `${getConfidenceColor(message.confidence)}20`,
                  color: getConfidenceColor(message.confidence),
                }}
              >
                {message.confidence}% confident
              </span>
            )}
          </div>
        )}

        {/* Message content */}
        <div className="text-sm whitespace-pre-wrap break-words">
          {message.content}
        </div>

        {/* Timestamp */}
        <div
          className="text-xs mt-1 text-right opacity-60"
          style={{ color: isUser ? theme.colors.accentForeground : theme.colors.textDim }}
        >
          {formatTimestamp(message.timestamp)}
        </div>
      </div>
    </div>
  );
}

/**
 * TypingIndicator - Shows when agent is "thinking"
 */
function TypingIndicator({ theme }: { theme: Theme }): JSX.Element {
  return (
    <div className="flex justify-start mb-4">
      <div
        className="rounded-lg rounded-bl-none px-4 py-3"
        style={{ backgroundColor: theme.colors.bgActivity }}
      >
        <div
          className="text-xs font-medium mb-2"
          style={{ color: theme.colors.accent }}
        >
          🎼 Maestro
        </div>
        <div className="flex items-center gap-1">
          <div
            className="w-2 h-2 rounded-full animate-bounce"
            style={{
              backgroundColor: theme.colors.accent,
              animationDelay: '0ms',
            }}
          />
          <div
            className="w-2 h-2 rounded-full animate-bounce"
            style={{
              backgroundColor: theme.colors.accent,
              animationDelay: '150ms',
            }}
          />
          <div
            className="w-2 h-2 rounded-full animate-bounce"
            style={{
              backgroundColor: theme.colors.accent,
              animationDelay: '300ms',
            }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * ConversationScreen - Project discovery conversation
 */
export function ConversationScreen({ theme }: ConversationScreenProps): JSX.Element {
  const {
    state,
    addMessage,
    setConfidenceLevel,
    setIsReadyToProceed,
    setConversationLoading,
    setConversationError,
    previousStep,
    nextStep,
  } = useWizard();

  // Local state
  const [inputValue, setInputValue] = useState('');
  const [conversationStarted, setConversationStarted] = useState(false);
  const [showInitialQuestion, setShowInitialQuestion] = useState(true);
  const [errorRetryCount, setErrorRetryCount] = useState(0);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom when messages change
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [state.conversationHistory, state.isConversationLoading, scrollToBottom]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Initialize conversation manager when entering this screen
  useEffect(() => {
    let mounted = true;

    async function initConversation() {
      if (!state.selectedAgent || !state.directoryPath) {
        return;
      }

      try {
        await conversationManager.startConversation({
          agentType: state.selectedAgent,
          directoryPath: state.directoryPath,
          projectName: state.agentName || 'My Project',
        });

        if (mounted) {
          setConversationStarted(true);
        }
      } catch (error) {
        console.error('Failed to initialize conversation:', error);
        if (mounted) {
          setConversationError('Failed to initialize conversation. Please try again.');
        }
      }
    }

    // Only initialize if we haven't started yet and have no messages
    if (!conversationStarted && state.conversationHistory.length === 0) {
      initConversation();
    } else {
      // Resume from existing state
      setConversationStarted(true);
      setShowInitialQuestion(state.conversationHistory.length === 0);
    }

    return () => {
      mounted = false;
    };
  }, [
    state.selectedAgent,
    state.directoryPath,
    state.agentName,
    state.conversationHistory.length,
    conversationStarted,
    setConversationError,
  ]);

  // Cleanup conversation when unmounting
  useEffect(() => {
    return () => {
      // Don't end the conversation on unmount - we want to preserve state
      // conversationManager.endConversation();
    };
  }, []);

  /**
   * Handle sending a message to the agent
   */
  const handleSendMessage = useCallback(async () => {
    const trimmedInput = inputValue.trim();
    if (!trimmedInput || state.isConversationLoading) {
      return;
    }

    // Clear input immediately
    setInputValue('');
    setShowInitialQuestion(false);
    setConversationError(null);

    // Add user message to history
    addMessage(createUserMessage(trimmedInput));

    // Set loading state
    setConversationLoading(true);

    try {
      // Re-initialize conversation if needed
      if (!conversationManager.isConversationActive()) {
        await conversationManager.startConversation({
          agentType: state.selectedAgent!,
          directoryPath: state.directoryPath,
          projectName: state.agentName || 'My Project',
        });
      }

      // Send message and wait for response
      const result = await conversationManager.sendMessage(
        trimmedInput,
        state.conversationHistory,
        {
          onSending: () => {
            // Already set loading state
          },
          onReceiving: () => {
            // Agent is responding
          },
          onChunk: (_chunk) => {
            // Could show streaming response here in the future
          },
          onComplete: (sendResult) => {
            if (sendResult.success && sendResult.response) {
              // Add assistant response to history
              addMessage(createAssistantMessage(sendResult.response));

              // Update confidence level
              if (sendResult.response.structured) {
                setConfidenceLevel(sendResult.response.structured.confidence);
                setIsReadyToProceed(
                  sendResult.response.structured.ready &&
                    sendResult.response.structured.confidence >= READY_CONFIDENCE_THRESHOLD
                );
              }

              // Reset error retry count on success
              setErrorRetryCount(0);
            }
          },
          onError: (error) => {
            console.error('Conversation error:', error);
            setConversationError(error);
            setErrorRetryCount((prev) => prev + 1);
          },
        }
      );

      // Handle non-callback completion path
      if (!result.success && result.error) {
        setConversationError(result.error);
        setErrorRetryCount((prev) => prev + 1);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setConversationError(errorMessage);
      setErrorRetryCount((prev) => prev + 1);
    } finally {
      setConversationLoading(false);
      // Refocus input
      inputRef.current?.focus();
    }
  }, [
    inputValue,
    state.isConversationLoading,
    state.conversationHistory,
    state.selectedAgent,
    state.directoryPath,
    state.agentName,
    addMessage,
    setConversationLoading,
    setConversationError,
    setConfidenceLevel,
    setIsReadyToProceed,
  ]);

  /**
   * Handle retry after error
   */
  const handleRetry = useCallback(() => {
    setConversationError(null);
    inputRef.current?.focus();
  }, [setConversationError]);

  /**
   * Handle keyboard events
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Enter to send (without shift for newline)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
      // Escape to go back (with confirmation if conversation started)
      else if (e.key === 'Escape') {
        if (state.conversationHistory.length === 0) {
          previousStep();
        } else {
          // Could add confirmation modal here
          previousStep();
        }
      }
    },
    [handleSendMessage, previousStep, state.conversationHistory.length]
  );

  /**
   * Handle "Let's Get Started" button click
   */
  const handleLetsGo = useCallback(() => {
    if (state.isReadyToProceed) {
      nextStep();
    }
  }, [state.isReadyToProceed, nextStep]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {/* Confidence Meter Header */}
      <div
        className="px-6 py-4 border-b"
        style={{
          backgroundColor: theme.colors.bgSidebar,
          borderColor: theme.colors.border,
        }}
      >
        <ConfidenceMeter confidence={state.confidenceLevel} theme={theme} />
      </div>

      {/* Conversation Area */}
      <div
        className="flex-1 overflow-y-auto px-6 py-4"
        style={{ backgroundColor: theme.colors.bgMain }}
      >
        {/* Initial Question (shown before first interaction) */}
        {showInitialQuestion && state.conversationHistory.length === 0 && (
          <div className="flex justify-start mb-4">
            <div
              className="max-w-[80%] rounded-lg rounded-bl-none px-4 py-3"
              style={{ backgroundColor: theme.colors.bgActivity }}
            >
              <div
                className="text-xs font-medium mb-2"
                style={{ color: theme.colors.accent }}
              >
                🎼 Maestro
              </div>
              <div className="text-sm" style={{ color: theme.colors.textMain }}>
                {getInitialQuestion()}
              </div>
            </div>
          </div>
        )}

        {/* Conversation History */}
        {state.conversationHistory.map((message) => (
          <MessageBubble key={message.id} message={message} theme={theme} />
        ))}

        {/* Typing Indicator */}
        {state.isConversationLoading && <TypingIndicator theme={theme} />}

        {/* Error Message */}
        {state.conversationError && (
          <div
            className="mx-auto max-w-md mb-4 p-4 rounded-lg text-center"
            style={{
              backgroundColor: `${theme.colors.error}20`,
              borderColor: theme.colors.error,
            }}
          >
            <p className="text-sm mb-2" style={{ color: theme.colors.error }}>
              {state.conversationError}
            </p>
            <button
              onClick={handleRetry}
              className="px-4 py-1.5 rounded text-sm font-medium transition-colors"
              style={{
                backgroundColor: theme.colors.error,
                color: 'white',
              }}
            >
              {errorRetryCount > 2 ? 'Try Again' : 'Dismiss'}
            </button>
          </div>
        )}

        {/* Ready to Proceed Message */}
        {state.isReadyToProceed && !state.isConversationLoading && (
          <div
            className="mx-auto max-w-md mb-4 p-4 rounded-lg text-center"
            style={{
              backgroundColor: `${theme.colors.success}15`,
              border: `1px solid ${theme.colors.success}40`,
            }}
          >
            <p
              className="text-sm font-medium mb-3"
              style={{ color: theme.colors.success }}
            >
              I think I have a good understanding of your project. Ready to create your action plan?
            </p>
            <button
              onClick={handleLetsGo}
              className="px-6 py-2.5 rounded-lg text-sm font-bold transition-all hover:scale-105"
              style={{
                backgroundColor: theme.colors.success,
                color: 'white',
                boxShadow: `0 4px 12px ${theme.colors.success}40`,
              }}
            >
              Let's Get Started! 🚀
            </button>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div
        className="px-6 py-4 border-t"
        style={{
          backgroundColor: theme.colors.bgSidebar,
          borderColor: theme.colors.border,
        }}
      >
        <div className="flex items-end gap-3">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                // Enter to send (without shift for newline)
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Describe your project..."
              disabled={state.isConversationLoading}
              rows={1}
              className="w-full px-4 py-3 rounded-lg border resize-none outline-none transition-all"
              style={{
                backgroundColor: theme.colors.bgMain,
                borderColor: theme.colors.border,
                color: theme.colors.textMain,
                minHeight: '48px',
                maxHeight: '120px',
              }}
              onInput={(e) => {
                // Auto-resize textarea
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
              }}
            />
          </div>
          <button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || state.isConversationLoading}
            className="px-4 py-3 rounded-lg font-medium transition-all flex items-center gap-2"
            style={{
              backgroundColor:
                inputValue.trim() && !state.isConversationLoading
                  ? theme.colors.accent
                  : theme.colors.border,
              color:
                inputValue.trim() && !state.isConversationLoading
                  ? theme.colors.accentForeground
                  : theme.colors.textDim,
              cursor:
                inputValue.trim() && !state.isConversationLoading
                  ? 'pointer'
                  : 'not-allowed',
            }}
          >
            {state.isConversationLoading ? (
              <div
                className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: 'currentColor', borderTopColor: 'transparent' }}
              />
            ) : (
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            )}
            Send
          </button>
        </div>

        {/* Keyboard hints */}
        <div className="mt-4 flex justify-center gap-6">
          <span
            className="text-xs flex items-center gap-1"
            style={{ color: theme.colors.textDim }}
          >
            <kbd
              className="px-1.5 py-0.5 rounded text-xs"
              style={{ backgroundColor: theme.colors.border }}
            >
              Enter
            </kbd>
            Send
          </span>
          <span
            className="text-xs flex items-center gap-1"
            style={{ color: theme.colors.textDim }}
          >
            <kbd
              className="px-1.5 py-0.5 rounded text-xs"
              style={{ backgroundColor: theme.colors.border }}
            >
              Shift+Enter
            </kbd>
            New line
          </span>
          <span
            className="text-xs flex items-center gap-1"
            style={{ color: theme.colors.textDim }}
          >
            <kbd
              className="px-1.5 py-0.5 rounded text-xs"
              style={{ backgroundColor: theme.colors.border }}
            >
              Esc
            </kbd>
            Back
          </span>
        </div>
      </div>

      {/* Bounce animation style */}
      <style>{`
        @keyframes bounce {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-4px);
          }
        }
        .animate-bounce {
          animation: bounce 0.6s infinite;
        }
      `}</style>
    </div>
  );
}
