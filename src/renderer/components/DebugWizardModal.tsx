/**
 * DebugWizardModal.tsx
 *
 * Debug modal for jumping directly to the wizard's Phase Review step.
 * Collects directory path and agent name, loads existing Auto Run docs,
 * then navigates to Phase Review.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FolderOpen, X } from 'lucide-react';
import type { Theme } from '../types';
import { useLayerStack } from '../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { useWizard, type WizardStep } from './Wizard/WizardContext';
import { AUTO_RUN_FOLDER_NAME } from './Wizard/services/phaseGenerator';
import path from 'path';

interface DebugWizardModalProps {
  theme: Theme;
  isOpen: boolean;
  onClose: () => void;
}

export function DebugWizardModal({
  theme,
  isOpen,
  onClose,
}: DebugWizardModalProps): JSX.Element | null {
  const [directoryPath, setDirectoryPath] = useState('');
  const [agentName, setAgentName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const { registerLayer, unregisterLayer } = useLayerStack();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const {
    openWizard,
    goToStep,
    setDirectoryPath: setWizardDirectoryPath,
    setAgentName: setWizardAgentName,
    setSelectedAgent,
    setGeneratedDocuments,
  } = useWizard();

  // Register with layer stack
  useEffect(() => {
    if (!isOpen) return;

    const id = registerLayer({
      type: 'modal',
      priority: MODAL_PRIORITIES.CONFIRM || 100,
      onEscape: () => onCloseRef.current(),
    });

    return () => unregisterLayer(id);
  }, [isOpen, registerLayer, unregisterLayer]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setDirectoryPath('');
      setAgentName('');
      setError(null);
      setLoading(false);
    }
  }, [isOpen]);

  const handleSelectDirectory = useCallback(async () => {
    try {
      const result = await window.maestro.dialog.selectFolder();
      if (result) {
        setDirectoryPath(result);
        // Auto-populate agent name from folder name
        const folderName = result.split('/').pop() || result.split('\\').pop() || 'My Project';
        if (!agentName) {
          setAgentName(folderName);
        }
        setError(null);
      }
    } catch (err) {
      console.error('Failed to select directory:', err);
    }
  }, [agentName]);

  const handleSubmit = useCallback(async () => {
    if (!directoryPath) {
      setError('Please select a directory');
      return;
    }

    if (!agentName.trim()) {
      setError('Please enter an agent name');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Check if Auto Run Docs folder exists
      const autoRunPath = `${directoryPath}/${AUTO_RUN_FOLDER_NAME}`;

      let files: string[] = [];
      try {
        const dirContents = await window.maestro.fs.readDir(autoRunPath);
        files = dirContents
          .filter((f: { name: string; isDirectory: boolean }) => !f.isDirectory && f.name.endsWith('.md'))
          .map((f: { name: string }) => f.name);
      } catch {
        setError(`No Auto Run Docs folder found at ${autoRunPath}`);
        setLoading(false);
        return;
      }

      if (files.length === 0) {
        setError(`No markdown files found in ${autoRunPath}`);
        setLoading(false);
        return;
      }

      // Load the documents
      const documents: Array<{
        filename: string;
        content: string;
        taskCount: number;
      }> = [];

      for (const filename of files) {
        try {
          const content = await window.maestro.fs.readFile(`${autoRunPath}/${filename}`);
          // Count tasks (markdown checkboxes)
          const taskCount = (content.match(/^-\s*\[\s*[xX ]?\s*\]/gm) || []).length;
          documents.push({ filename, content, taskCount });
        } catch (err) {
          console.warn(`Failed to read ${filename}:`, err);
        }
      }

      if (documents.length === 0) {
        setError('Failed to load any documents');
        setLoading(false);
        return;
      }

      // Set wizard state
      setSelectedAgent('claude-code');
      setWizardDirectoryPath(directoryPath);
      setWizardAgentName(agentName.trim());
      setGeneratedDocuments(documents);

      // Open wizard and navigate to phase-review
      openWizard();

      // Small delay to ensure wizard is mounted
      setTimeout(() => {
        goToStep('phase-review');
      }, 100);

      onClose();
    } catch (err) {
      console.error('Failed to load documents:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  }, [
    directoryPath,
    agentName,
    openWizard,
    goToStep,
    setWizardDirectoryPath,
    setWizardAgentName,
    setSelectedAgent,
    setGeneratedDocuments,
    onClose,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !loading) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, loading]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999]">
      <div
        className="w-[500px] rounded-xl shadow-2xl border overflow-hidden"
        style={{
          backgroundColor: theme.colors.bgActivity,
          borderColor: theme.colors.border,
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between"
          style={{ borderColor: theme.colors.border }}
        >
          <h2
            className="text-lg font-semibold"
            style={{ color: theme.colors.textMain }}
          >
            Debug: Jump to Phase Review
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:opacity-70 transition-opacity"
            style={{ color: theme.colors.textDim }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Directory picker */}
          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: theme.colors.textMain }}
            >
              Project Directory
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={directoryPath}
                onChange={(e) => setDirectoryPath(e.target.value)}
                placeholder="/path/to/project"
                className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                style={{
                  backgroundColor: theme.colors.bgMain,
                  color: theme.colors.textMain,
                  border: `1px solid ${theme.colors.border}`,
                }}
              />
              <button
                onClick={handleSelectDirectory}
                className="px-3 py-2 rounded-lg flex items-center gap-2 hover:opacity-80 transition-opacity"
                style={{
                  backgroundColor: theme.colors.bgMain,
                  color: theme.colors.textMain,
                  border: `1px solid ${theme.colors.border}`,
                }}
              >
                <FolderOpen className="w-4 h-4" />
                Browse
              </button>
            </div>
            <p
              className="text-xs mt-1"
              style={{ color: theme.colors.textDim }}
            >
              Must contain an "{AUTO_RUN_FOLDER_NAME}" folder with .md files
            </p>
          </div>

          {/* Agent name */}
          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: theme.colors.textMain }}
            >
              Agent Name
            </label>
            <input
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="My Project"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{
                backgroundColor: theme.colors.bgMain,
                color: theme.colors.textMain,
                border: `1px solid ${theme.colors.border}`,
              }}
            />
          </div>

          {/* Error message */}
          {error && (
            <div
              className="text-sm p-3 rounded-lg"
              style={{
                backgroundColor: `${theme.colors.error}20`,
                color: theme.colors.error,
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 border-t flex justify-end gap-3"
          style={{ borderColor: theme.colors.border }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity"
            style={{
              backgroundColor: theme.colors.bgMain,
              color: theme.colors.textDim,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{
              backgroundColor: theme.colors.accent,
              color: theme.colors.accentForeground,
            }}
          >
            {loading ? 'Loading...' : 'Jump to Phase Review'}
          </button>
        </div>
      </div>
    </div>
  );
}
