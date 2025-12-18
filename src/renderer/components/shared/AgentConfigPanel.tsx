/**
 * AgentConfigPanel.tsx
 *
 * Shared component for agent configuration settings.
 * Used by both NewInstanceModal and the Wizard's AgentSelectionScreen.
 *
 * Displays:
 * - Detected path (read-only)
 * - Custom path input
 * - Custom arguments input
 * - Environment variables (key-value pairs)
 * - Agent-specific config options (contextWindow, model, etc.)
 */

import React from 'react';
import { RefreshCw, Plus, Trash2 } from 'lucide-react';
import type { Theme, AgentConfig } from '../../types';

export interface AgentConfigPanelProps {
  theme: Theme;
  agent: AgentConfig;
  // Custom path
  customPath: string;
  onCustomPathChange: (value: string) => void;
  onCustomPathBlur: () => void;
  onCustomPathClear: () => void;
  // Custom arguments
  customArgs: string;
  onCustomArgsChange: (value: string) => void;
  onCustomArgsBlur: () => void;
  onCustomArgsClear: () => void;
  // Environment variables
  customEnvVars: Record<string, string>;
  onEnvVarKeyChange: (oldKey: string, newKey: string, value: string) => void;
  onEnvVarValueChange: (key: string, value: string) => void;
  onEnvVarRemove: (key: string) => void;
  onEnvVarAdd: () => void;
  onEnvVarsBlur: () => void;
  // Agent-specific config options
  agentConfig: Record<string, any>;
  onConfigChange: (key: string, value: any) => void;
  onConfigBlur: () => void;
  // Model selection (if supported)
  availableModels?: string[];
  loadingModels?: boolean;
  onRefreshModels?: () => void;
  // Agent refresh
  onRefreshAgent?: () => void;
  refreshingAgent?: boolean;
  // Optional: compact mode for wizard (less padding)
  compact?: boolean;
}

export function AgentConfigPanel({
  theme,
  agent,
  customPath,
  onCustomPathChange,
  onCustomPathBlur,
  onCustomPathClear,
  customArgs,
  onCustomArgsChange,
  onCustomArgsBlur,
  onCustomArgsClear,
  customEnvVars,
  onEnvVarKeyChange,
  onEnvVarValueChange,
  onEnvVarRemove,
  onEnvVarAdd,
  onEnvVarsBlur,
  agentConfig,
  onConfigChange,
  onConfigBlur,
  availableModels = [],
  loadingModels = false,
  onRefreshModels,
  onRefreshAgent,
  refreshingAgent = false,
  compact = false,
}: AgentConfigPanelProps): JSX.Element {
  const padding = compact ? 'p-2' : 'p-3';
  const spacing = compact ? 'space-y-2' : 'space-y-3';

  return (
    <div className={spacing}>
      {/* Show detected path if available */}
      {agent.path && (
        <div
          className="text-xs font-mono px-3 py-2 rounded flex items-center justify-between"
          style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
        >
          <div>
            <span className="opacity-60">Detected:</span> {agent.path}
          </div>
          {onRefreshAgent && (
            <button
              onClick={onRefreshAgent}
              className="p-1 rounded hover:bg-white/10 transition-colors ml-2"
              title="Refresh detection"
              style={{ color: theme.colors.textDim }}
            >
              <RefreshCw className={`w-3 h-3 ${refreshingAgent ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      )}

      {/* Custom path input */}
      <div
        className={`${padding} rounded border`}
        style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
      >
        <label className="block text-xs font-medium mb-2" style={{ color: theme.colors.textDim }}>
          Custom Path (optional)
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={customPath}
            onChange={(e) => onCustomPathChange(e.target.value)}
            onBlur={onCustomPathBlur}
            onClick={(e) => e.stopPropagation()}
            placeholder={`/path/to/${agent.binaryName}`}
            className="flex-1 p-2 rounded border bg-transparent outline-none text-xs font-mono"
            style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
          />
          {customPath && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCustomPathClear();
              }}
              className="px-2 py-1.5 rounded text-xs"
              style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-xs opacity-50 mt-2">
          Specify a custom path if the agent is not in your PATH
        </p>
      </div>

      {/* Custom CLI arguments input */}
      <div
        className={`${padding} rounded border`}
        style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
      >
        <label className="block text-xs font-medium mb-2" style={{ color: theme.colors.textDim }}>
          Custom Arguments (optional)
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={customArgs}
            onChange={(e) => onCustomArgsChange(e.target.value)}
            onBlur={onCustomArgsBlur}
            onClick={(e) => e.stopPropagation()}
            placeholder="--flag value --another-flag"
            className="flex-1 p-2 rounded border bg-transparent outline-none text-xs font-mono"
            style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
          />
          {customArgs && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCustomArgsClear();
              }}
              className="px-2 py-1.5 rounded text-xs"
              style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-xs opacity-50 mt-2">
          Additional CLI arguments appended to all calls to this agent
        </p>
      </div>

      {/* Custom environment variables input */}
      <div
        className={`${padding} rounded border`}
        style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
      >
        <label className="block text-xs font-medium mb-2" style={{ color: theme.colors.textDim }}>
          Environment Variables (optional)
        </label>
        <div className="space-y-2">
          {/* Existing env vars */}
          {Object.entries(customEnvVars).map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <input
                type="text"
                value={key}
                onChange={(e) => onEnvVarKeyChange(key, e.target.value, value)}
                onBlur={onEnvVarsBlur}
                onClick={(e) => e.stopPropagation()}
                placeholder="VARIABLE_NAME"
                className="flex-1 p-2 rounded border bg-transparent outline-none text-xs font-mono"
                style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
              />
              <span className="flex items-center text-xs" style={{ color: theme.colors.textDim }}>=</span>
              <input
                type="text"
                value={value}
                onChange={(e) => onEnvVarValueChange(key, e.target.value)}
                onBlur={onEnvVarsBlur}
                onClick={(e) => e.stopPropagation()}
                placeholder="value"
                className="flex-[2] p-2 rounded border bg-transparent outline-none text-xs font-mono"
                style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEnvVarRemove(key);
                }}
                className="p-2 rounded hover:bg-white/10 transition-colors"
                title="Remove variable"
                style={{ color: theme.colors.textDim }}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          {/* Add new env var button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEnvVarAdd();
            }}
            className="flex items-center gap-1 px-2 py-1.5 rounded text-xs hover:bg-white/10 transition-colors"
            style={{ color: theme.colors.textDim }}
          >
            <Plus className="w-3 h-3" />
            Add Variable
          </button>
        </div>
        <p className="text-xs opacity-50 mt-2">
          Environment variables passed to all calls to this agent
        </p>
      </div>

      {/* Agent-specific configuration options (contextWindow, model, etc.) */}
      {agent.configOptions && agent.configOptions.length > 0 && agent.configOptions.map((option: any) => (
        <div
          key={option.key}
          className={`${padding} rounded border`}
          style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
        >
          <label className="block text-xs font-medium mb-2" style={{ color: theme.colors.textDim }}>
            {option.label}
          </label>
          {option.type === 'number' && (
            <input
              type="number"
              value={agentConfig[option.key] ?? option.default}
              onChange={(e) => {
                const value = e.target.value === '' ? 0 : parseInt(e.target.value, 10);
                onConfigChange(option.key, isNaN(value) ? 0 : value);
              }}
              onBlur={onConfigBlur}
              onClick={(e) => e.stopPropagation()}
              placeholder={option.default?.toString() || '0'}
              min={0}
              className="w-full p-2 rounded border bg-transparent outline-none text-xs font-mono"
              style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
            />
          )}
          {option.type === 'text' && (
            <>
              <div className="flex gap-2">
                <input
                  type="text"
                  list={option.key === 'model' ? `models-${agent.id}` : undefined}
                  value={agentConfig[option.key] ?? option.default}
                  onChange={(e) => onConfigChange(option.key, e.target.value)}
                  onBlur={onConfigBlur}
                  onClick={(e) => e.stopPropagation()}
                  placeholder={option.default || ''}
                  className="flex-1 p-2 rounded border bg-transparent outline-none text-xs font-mono"
                  style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
                />
                {option.key === 'model' && agent.capabilities?.supportsModelSelection && onRefreshModels && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRefreshModels();
                    }}
                    className="p-2 rounded border hover:bg-white/10 transition-colors"
                    title="Refresh available models"
                    style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingModels ? 'animate-spin' : ''}`} />
                  </button>
                )}
              </div>
              {/* Datalist for model autocomplete */}
              {option.key === 'model' && availableModels.length > 0 && (
                <datalist id={`models-${agent.id}`}>
                  {availableModels.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              )}
              {option.key === 'model' && loadingModels && (
                <p className="text-xs mt-1" style={{ color: theme.colors.textDim }}>
                  Loading available models...
                </p>
              )}
              {option.key === 'model' && !loadingModels && availableModels.length > 0 && (
                <p className="text-xs mt-1" style={{ color: theme.colors.textDim }}>
                  {availableModels.length} model{availableModels.length !== 1 ? 's' : ''} available
                </p>
              )}
            </>
          )}
          {option.type === 'checkbox' && (
            <label className="flex items-center gap-2 cursor-pointer" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={agentConfig[option.key] ?? option.default}
                onChange={(e) => {
                  onConfigChange(option.key, e.target.checked);
                  // Immediately persist checkbox changes
                  onConfigBlur();
                }}
                className="w-4 h-4"
                style={{ accentColor: theme.colors.accent }}
              />
              <span className="text-xs" style={{ color: theme.colors.textMain }}>Enabled</span>
            </label>
          )}
          <p className="text-xs opacity-50 mt-2">
            {option.description}
          </p>
        </div>
      ))}
    </div>
  );
}
