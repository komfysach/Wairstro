# Refactor Details 1: Fix ESLint Warnings - Executable Tasks

> **Generated:** December 25, 2024
> **Source:** `refactor-details-1.md` analysis converted to Auto Run tasks
> **Note:** ESLint auto-fix already ran - these are the remaining manual fixes

---

## Phase 1: Unused Imports (Remove)

These imports are defined but never used - remove them entirely.

- [ ] In `src/renderer/App.tsx`, remove unused import `createMergedSession` from line 109
- [ ] In `src/renderer/App.tsx`, remove unused import `TAB_SHORTCUTS` from line 110
- [ ] In `src/renderer/App.tsx`, remove unused import `DEFAULT_CONTEXT_WINDOWS` from line 115
- [ ] In `src/renderer/components/AICommandsPanel.tsx`, remove unused import `RotateCcw` from line 2
- [ ] In `src/renderer/components/AgentPromptComposerModal.tsx`, remove unused import `useCallback` from line 1
- [ ] In `src/renderer/components/AutoRunExpandedModal.tsx`, remove unused import `Image` from line 3
- [ ] In `src/renderer/components/BatchRunnerModal.tsx`, remove unused import `countUncheckedTasks` from line 45
- [ ] In `src/renderer/components/DebugPackageModal.tsx`, remove unused import `X` from line 12
- [ ] In `src/renderer/components/FilePreview.tsx`, remove unused imports `Copy` and `FileText` from line 7

---

## Phase 2: Unused Error Variables (Prefix with _)

These catch block errors are intentionally unused - prefix with underscore.

- [ ] In `src/cli/services/agent-spawner.ts` line 539, rename `error` to `_error` in catch block
- [ ] In `src/cli/services/agent-spawner.ts` line 557, rename `error` to `_error` in catch block
- [ ] In `src/main/agent-detector.ts` line 680, rename `error` to `_error` in catch block
- [ ] In `src/main/ipc/handlers/persistence.ts` line 200, rename `error` to `_error` in catch block
- [ ] In `src/main/ipc/handlers/system.ts` line 351, rename `error` to `_error` in catch block
- [ ] In `src/main/process-manager.ts` line 847, rename `e` to `_e` in catch block
- [ ] In `src/main/utils/shellDetector.ts` line 93, rename `error` to `_error` in catch block
- [ ] In `src/renderer/components/CreatePRModal.tsx` line 149, rename `err` to `_err` in catch block
- [ ] In `src/renderer/components/CreatePRModal.tsx` line 160, rename `err` to `_err` in catch block
- [ ] In `src/renderer/components/CustomThemeBuilder.tsx` line 357, rename `err` to `_err` in catch block
- [ ] In `src/renderer/components/FilePreview.tsx` line 846, rename `err` to `_err` in catch block

---

## Phase 3: Unused Assigned Variables in Main Process (Prefix with _)

- [ ] In `src/main/index.ts` line 1903, rename `resultMessageCount` to `_resultMessageCount`
- [ ] In `src/main/index.ts` line 1908, rename `textMessageCount` to `_textMessageCount`
- [ ] In `src/main/ipc/handlers/agents.ts` line 44, rename `resumeArgs` to `_resumeArgs`
- [ ] In `src/main/ipc/handlers/agents.ts` line 45, rename `modelArgs` to `_modelArgs`
- [ ] In `src/main/ipc/handlers/agents.ts` line 46, rename `workingDirArgs` to `_workingDirArgs`
- [ ] In `src/main/ipc/handlers/agents.ts` line 47, rename `imageArgs` to `_imageArgs`
- [ ] In `src/main/ipc/handlers/agents.ts` line 54, rename `argBuilder` to `_argBuilder`
- [ ] In `src/main/process-manager.ts` line 1343, rename `stdoutBuffer` to `_stdoutBuffer`
- [ ] In `src/main/process-manager.ts` line 1344, rename `stderrBuffer` to `_stderrBuffer`

---

## Phase 4: Unused Variables in App.tsx (Prefix with _)

- [ ] In `src/renderer/App.tsx` line 229, rename `loadResumeState` to `_loadResumeState`
- [ ] In `src/renderer/App.tsx` line 232, rename `closeWizardModal` to `_closeWizardModal`
- [ ] In `src/renderer/App.tsx` line 275, rename `globalStats` to `_globalStats`
- [ ] In `src/renderer/App.tsx` line 277, rename `tourCompleted` to `_tourCompleted`
- [ ] In `src/renderer/App.tsx` line 283, rename `updateContextManagementSettings` to `_updateContextManagementSettings`
- [ ] In `src/renderer/App.tsx` line 397, rename `shortcutsSearchQuery` to `_shortcutsSearchQuery`
- [ ] In `src/renderer/App.tsx` line 403, rename `lightboxSource` to `_lightboxSource`
- [ ] In `src/renderer/App.tsx` line 523, rename `renameGroupEmojiPickerOpen` to `_renameGroupEmojiPickerOpen`
- [ ] In `src/renderer/App.tsx` line 523, rename `setRenameGroupEmojiPickerOpen` to `_setRenameGroupEmojiPickerOpen`
- [ ] In `src/renderer/App.tsx` line 783, rename `hasSessionsLoaded` to `_hasSessionsLoaded`
- [ ] In `src/renderer/App.tsx` line 2286, rename `pendingRemoteCommandRef` to `_pendingRemoteCommandRef`
- [ ] In `src/renderer/App.tsx` line 2669, rename `mergeError` to `_mergeError`
- [ ] In `src/renderer/App.tsx` line 2675, rename `cancelMerge` to `_cancelMerge`
- [ ] In `src/renderer/App.tsx` line 2752, rename `transferError` to `_transferError`
- [ ] In `src/renderer/App.tsx` line 2753, rename `executeTransfer` to `_executeTransfer`
- [ ] In `src/renderer/App.tsx` line 2791, rename `summarizeError` to `_summarizeError`
- [ ] In `src/renderer/App.tsx` line 3119, rename `spawnAgentWithPrompt` to `_spawnAgentWithPrompt`
- [ ] In `src/renderer/App.tsx` line 3122, rename `spawnAgentWithPromptRef` to `_spawnAgentWithPromptRef`
- [ ] In `src/renderer/App.tsx` line 3123, rename `showFlashNotification` to `_showFlashNotification`
- [ ] In `src/renderer/App.tsx` line 3155, rename `batchRunStates` to `_batchRunStates`
- [ ] In `src/renderer/App.tsx` line 3529, rename `processInputRef` to `_processInputRef`
- [ ] In `src/renderer/App.tsx` line 4038, rename parameter `prev` to `_prev`
- [ ] In `src/renderer/App.tsx` line 5024, rename `initializeMergedSession` to `_initializeMergedSession`
- [ ] In `src/renderer/App.tsx` line 5197, rename `result` to `_result`

---

## Phase 5: Unused Variables in Components (Prefix with _)

- [ ] In `src/renderer/components/AchievementCard.tsx` line 159, rename `onClose` to `_onClose`
- [ ] In `src/renderer/components/AutoRun.tsx` line 522, rename `closeAutocomplete` to `_closeAutocomplete`
- [ ] In `src/renderer/components/AutoRun.tsx` line 716, rename `handleCursorOrScrollChange` to `_handleCursorOrScrollChange`
- [ ] In `src/renderer/components/AutoRunDocumentSelector.tsx` line 78, rename `getDisplayName` to `_getDisplayName`
- [ ] In `src/renderer/components/BatchRunnerModal.tsx` line 203, rename `hasMissingDocs` to `_hasMissingDocs`
- [ ] In `src/renderer/components/ContextWarningSash.tsx` line 27, rename `theme` to `_theme`
- [ ] In `src/renderer/components/DocumentsPanel.tsx` line 160, rename `countBefore` to `_countBefore`
- [ ] In `src/renderer/components/DocumentsPanel.tsx` line 344, rename `someSelected` to `_someSelected`
- [ ] In `src/renderer/components/FilePreview.tsx` line 1539, rename `node` to `_node`
- [ ] In `src/renderer/components/FilePreview.tsx` line 1564, rename `node` to `_node`
- [ ] In `src/renderer/components/FilePreview.tsx` line 1595, rename `node` to `_node`
- [ ] In `src/renderer/components/FilePreview.tsx` line 1600, rename `markdownDir` to `_markdownDir`

---

## Phase 6: React Hooks - Safe Dependency Additions

These hooks are missing dependencies that can safely be added without causing infinite loops.

- [ ] In `src/renderer/App.tsx` line 612, add `previewFile` to useEffect dependency array
- [ ] In `src/renderer/App.tsx` line 876, add `getUnacknowledgedKeyboardMasteryLevel` to useEffect dependency array
- [ ] In `src/renderer/App.tsx` line 4368, add `activeSession.id` to useEffect dependency array
- [ ] In `src/renderer/App.tsx` line 5581, add `addLogToActiveTab` to useEffect dependency array
- [ ] In `src/renderer/App.tsx` line 5907, add `processQueuedItem` to useEffect dependency array
- [ ] In `src/renderer/components/AgentSessionsBrowser.tsx` line 339, add `setViewingSession` to useCallback dependency array
- [ ] In `src/renderer/components/AgentSessionsModal.tsx` line 97, add `viewingSession` to useEffect dependency array
- [ ] In `src/renderer/components/AgentSessionsModal.tsx` line 172, add `activeSession?.cwd` to useEffect dependency array
- [ ] In `src/renderer/components/CreatePRModal.tsx` line 130, add `checkUncommittedChanges` to useEffect dependency array
- [ ] In `src/renderer/components/ExecutionQueueBrowser.tsx` line 431, add `handleMouseUp` to useEffect dependency array

---

## Phase 7: React Hooks - Wrap Functions in useCallback

These functions cause dependency changes on every render.

- [ ] In `src/renderer/App.tsx`, wrap `handleFileClick` (line ~6555) in useCallback with appropriate dependencies
- [ ] In `src/renderer/App.tsx`, wrap `toggleFolder` (line ~6615) in useCallback with appropriate dependencies

---

## Phase 8: React Hooks - Fix Ref Cleanup

- [ ] In `src/renderer/App.tsx` line 2144, copy `thinkingChunkBufferRef.current` to local variable before cleanup function uses it

---

## Phase 9: React Hooks - Intentionally Omitted (Add ESLint Disable Comments)

These dependencies are intentionally omitted. Add eslint-disable comments with justification.

- [ ] In `src/renderer/App.tsx` line 823, add `// eslint-disable-next-line react-hooks/exhaustive-deps` with comment explaining activeSessionId/setActiveSessionId are intentionally omitted for load-once behavior
- [ ] In `src/renderer/App.tsx` line 2146, add `// eslint-disable-next-line react-hooks/exhaustive-deps` with comment explaining refs intentionally omitted to prevent re-subscription
- [ ] In `src/renderer/App.tsx` line 2420, add `// eslint-disable-next-line react-hooks/exhaustive-deps` with comment explaining activeSession intentionally omitted
- [ ] In `src/renderer/App.tsx` line 2469, add `// eslint-disable-next-line react-hooks/exhaustive-deps` with comment explaining activeSession intentionally omitted
- [ ] In `src/renderer/App.tsx` line 3000, add `// eslint-disable-next-line react-hooks/exhaustive-deps` with comment explaining activeSession intentionally omitted
- [ ] In `src/renderer/App.tsx` line 6755, add `// eslint-disable-next-line react-hooks/exhaustive-deps` with comment explaining activeSession intentionally omitted
- [ ] In `src/renderer/App.tsx` line 6787, add `// eslint-disable-next-line react-hooks/exhaustive-deps` with comment explaining activeSession intentionally omitted
- [ ] In `src/renderer/components/AutoRun.tsx` line 622, add `// eslint-disable-next-line react-hooks/exhaustive-deps` with comment explaining setMode intentionally omitted
- [ ] In `src/renderer/components/AutoRun.tsx` line 658, add `// eslint-disable-next-line react-hooks/exhaustive-deps` with comment explaining mode/setMode intentionally omitted for init-only behavior
- [ ] In `src/renderer/components/AutoRun.tsx` line 669, add `// eslint-disable-next-line react-hooks/exhaustive-deps` with comment explaining initial positions intentionally omitted
- [ ] In `src/renderer/components/AutoRun.tsx` line 792, add `// eslint-disable-next-line react-hooks/exhaustive-deps` with comment explaining currentMatchIndex intentionally omitted
- [ ] In `src/renderer/components/BatchRunnerModal.tsx` line 230, add `// eslint-disable-next-line react-hooks/exhaustive-deps` with comment explaining onClose/setShowSavePlaybookModal intentionally omitted
- [ ] In `src/renderer/components/BatchRunnerModal.tsx` line 245, add `// eslint-disable-next-line react-hooks/exhaustive-deps` with comment explaining setShowSavePlaybookModal intentionally omitted
- [ ] In `src/renderer/components/FileExplorerPanel.tsx` line 200, add `// eslint-disable-next-line react-hooks/exhaustive-deps` with comment explaining setters intentionally omitted
- [ ] In `src/renderer/components/FileExplorerPanel.tsx` line 349, add `// eslint-disable-next-line react-hooks/exhaustive-deps` with comment explaining session intentionally omitted

---

## Phase 10: React Hooks - Complex Expression & Risky Additions

Review these carefully - may need special handling.

- [ ] In `src/renderer/App.tsx` line 3742, extract complex expression to a variable before using in dependency array
- [ ] In `src/renderer/App.tsx` line 863, review and add `autoRunStats.longestRunMs` and `getUnacknowledgedBadgeLevel` - ensure no infinite loops
- [ ] In `src/renderer/App.tsx` line 4120, review and add `setActiveSessionId` to useCallback - ensure callback stability
- [ ] In `src/renderer/App.tsx` line 4998, review and add `addToast` and `sessions` - may cause re-renders

---

## Final Verification

- [ ] Run `npm run lint:eslint` and verify warning count is significantly reduced
- [ ] Run `npm run lint` to verify no TypeScript errors introduced
- [ ] Run `npm run dev` and verify app starts without console errors
