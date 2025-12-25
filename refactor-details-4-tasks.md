# Refactor Details 4: useBatchProcessor.ts - Executable Tasks

> **Generated:** December 25, 2024
> **Source:** `refactor-details-4.md` analysis converted to Auto Run tasks
> **Target File:** `src/renderer/hooks/useBatchProcessor.ts` (1,820 lines)

---

## Phase 1: Create Directory Structure and Utility Files

- [ ] Create directory `src/renderer/hooks/batch/` for batch processing modules
- [ ] Create `src/renderer/hooks/batch/batchUtils.ts` with utility functions extracted from useBatchProcessor: `countUnfinishedTasks`, `countCheckedTasks`, `uncheckAllTasks`
- [ ] Create `src/renderer/hooks/batch/index.ts` that exports all batch-related hooks and utilities

---

## Phase 2: Create useSessionDebounce Hook

- [ ] Create `src/renderer/hooks/batch/useSessionDebounce.ts` with a reusable debounce hook that handles proper cleanup
- [ ] The hook should track timers per session ID in a ref
- [ ] The hook should track pending updates per session ID in a ref
- [ ] The hook should have a mounted ref to prevent state updates after unmount
- [ ] The cleanup effect should clear all timers synchronously on unmount
- [ ] The hook should support composing multiple updates during the debounce window
- [ ] The hook should support an `immediate` parameter to bypass debouncing
- [ ] Export `useSessionDebounce` from `src/renderer/hooks/batch/index.ts`

---

## Phase 3: Create Batch Reducer

- [ ] Create `src/renderer/hooks/batch/batchReducer.ts` with TypeScript types for batch state
- [ ] Define `BatchAction` union type with actions: START_BATCH, UPDATE_PROGRESS, SET_STOPPING, SET_ERROR, CLEAR_ERROR, COMPLETE_BATCH, INCREMENT_LOOP
- [ ] Define `BatchState` type as `Record<string, BatchRunState>`
- [ ] Define `DEFAULT_BATCH_STATE` constant with all required fields initialized
- [ ] Implement `batchReducer` function that handles all action types
- [ ] Export reducer, types, and DEFAULT_BATCH_STATE from `src/renderer/hooks/batch/index.ts`

---

## Phase 4: Create useTimeTracking Hook

- [ ] Create `src/renderer/hooks/batch/useTimeTracking.ts` for visibility-aware time tracking
- [ ] The hook should accept a callback to get active session IDs
- [ ] Implement `startTracking(sessionId)` to begin tracking elapsed time
- [ ] Implement `stopTracking(sessionId)` to stop and return final elapsed time
- [ ] Implement `getElapsedTime(sessionId)` to get current elapsed time
- [ ] Add visibility change event listener that pauses time when document is hidden
- [ ] Add visibility change event listener that resumes time when document becomes visible
- [ ] Ensure cleanup removes the visibility change listener
- [ ] Export `useTimeTracking` from `src/renderer/hooks/batch/index.ts`

---

## Phase 5: Create useDocumentProcessor Hook

- [ ] Create `src/renderer/hooks/batch/useDocumentProcessor.ts` for document processing logic
- [ ] Define `DocumentProcessorConfig` interface with folderPath, session, gitBranch, groupName, loopIteration, effectiveCwd, customPrompt
- [ ] Define `TaskResult` interface with success, agentSessionId, usageStats, elapsedTimeMs, tasksCompletedThisRun, newRemainingTasks, shortSummary, fullSynopsis, documentChanged
- [ ] Implement `readDocAndCountTasks` callback that reads a document and counts unfinished tasks
- [ ] Implement `processTask` callback that processes a single task in a document
- [ ] processTask should build template context and substitute variables in prompt
- [ ] processTask should expand template variables in document content before spawning agent
- [ ] processTask should spawn the agent and track elapsed time
- [ ] processTask should re-read document after task to count completed tasks
- [ ] processTask should generate synopsis using onSpawnSynopsis callback
- [ ] Export `useDocumentProcessor` from `src/renderer/hooks/batch/index.ts`

---

## Phase 6: Create useWorktreeManager Hook

- [ ] Create `src/renderer/hooks/batch/useWorktreeManager.ts` for git worktree operations
- [ ] Define `WorktreeConfig` interface with enabled, path, branchName, createPROnCompletion, prTargetBranch, ghPath
- [ ] Define `WorktreeSetupResult` interface with success, effectiveCwd, worktreeActive, worktreePath, worktreeBranch, error
- [ ] Implement `setupWorktree` callback that sets up a git worktree for batch processing
- [ ] setupWorktree should handle branch mismatch by calling worktreeCheckout
- [ ] setupWorktree should return appropriate result whether worktree is enabled or not
- [ ] Implement `createPR` callback that creates a pull request after batch completion
- [ ] createPR should get default branch if prTargetBranch not specified
- [ ] createPR should generate PR body with document list and task count
- [ ] Export `useWorktreeManager` from `src/renderer/hooks/batch/index.ts`

---

## Phase 7: Create Batch State Machine

- [ ] Create `src/renderer/hooks/batch/batchStateMachine.ts` with explicit state definitions
- [ ] Define `BatchProcessingState` type with states: IDLE, INITIALIZING, RUNNING, PAUSED_ERROR, STOPPING, COMPLETING
- [ ] Define `BatchMachineContext` interface with state, sessionId, documents, currentDocIndex, completedTasks, totalTasks, loopIteration, error
- [ ] Define `BatchEvent` union type for all state transitions
- [ ] Implement `transition` function that returns new context based on current state and event
- [ ] Document valid state transitions in comments
- [ ] Export types and transition function from `src/renderer/hooks/batch/index.ts`

---

## Phase 8: Migrate useBatchProcessor to Use New Modules

- [ ] In `src/renderer/hooks/useBatchProcessor.ts`, import utilities from `./batch/batchUtils`
- [ ] Replace inline `countUnfinishedTasks`, `countCheckedTasks`, `uncheckAllTasks` with imports
- [ ] Import and use `useSessionDebounce` to replace manual debounce timer management
- [ ] Remove `debounceTimerRefs` ref and related cleanup code
- [ ] Remove `pendingUpdatesRef` ref and related composition code
- [ ] Import `batchReducer` and `DEFAULT_BATCH_STATE` from `./batch/batchReducer`
- [ ] Replace `useState` for `batchRunStates` with `useReducer(batchReducer, {})`
- [ ] Update all `setBatchRunStates` calls to use dispatch with appropriate actions
- [ ] Import and use `useTimeTracking` to replace manual time tracking
- [ ] Remove `accumulatedTimeRefs` and `lastActiveTimestampRefs`
- [ ] Remove visibility change event listener effect (now handled by useTimeTracking)
- [ ] Wire up time tracking callbacks to update batch state

---

## Phase 9: Migrate startBatchRun to Use Extracted Hooks

- [ ] Import and use `useWorktreeManager` in useBatchProcessor
- [ ] Replace inline worktree setup code with `setupWorktree` from useWorktreeManager
- [ ] Replace inline PR creation code with `createPR` from useWorktreeManager
- [ ] Import and use `useDocumentProcessor` in useBatchProcessor
- [ ] Replace inline document reading with `readDocAndCountTasks` from useDocumentProcessor
- [ ] Replace inline task processing with `processTask` from useDocumentProcessor
- [ ] Reduce `startBatchRun` to orchestration logic only - delegate to extracted hooks

---

## Phase 10: Fix Memory Leak Risks

- [ ] In useBatchProcessor cleanup effect, ensure all error resolution promises are rejected with 'abort' on unmount
- [ ] Clear `stopRequestedRefs` entry when batch completes normally (not just on start)
- [ ] Verify `isMountedRef` check prevents all state updates after unmount
- [ ] Add comment documenting memory safety guarantees

---

## Phase 11: Add State Machine Integration (Optional)

- [ ] Import `transition` and types from `./batch/batchStateMachine`
- [ ] Add state machine tracking to batch state
- [ ] Gate operations through state machine transitions
- [ ] Add invariant checks for invalid state transitions
- [ ] Log state transitions for debugging

---

## Final Verification

- [ ] Run `npm run lint` to verify no TypeScript errors
- [ ] Run `npm run lint:eslint` to verify no new ESLint warnings
- [ ] Verify batch processing works: start batch, complete all tasks
- [ ] Verify stop works: start batch, stop mid-task
- [ ] Verify error handling: start batch, trigger error, resume/skip/abort
- [ ] Verify loop mode: enable loop, run until max iterations
- [ ] Verify worktree mode: enable worktree, verify PR creation
- [ ] Verify time tracking works across visibility changes (hide/show window)
