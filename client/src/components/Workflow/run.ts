import { useCallback, useMemo, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type { WorkflowExecutor, WorkflowRunCallbacks, WorkflowRunHandle } from './api';
import type { WorkflowStartInput } from './types';
import type { WorkflowRunState } from './state';
import {
  dispatchWorkflowAtom,
  workflowActiveRunAtom,
  workflowBlockerAtom,
  workflowDraftAtom,
  workflowReadyAtom,
} from './atoms';
import { isDraftValid } from './state';

/**
 * Drives a run through an injected {@link WorkflowExecutor} and mirrors every
 * callback into the feature reducer. The executor owns how a step runs; this
 * hook owns the run id, the callbacks and the cooperative controls, so the same
 * code serves a real transport and the in-memory reference.
 */

/** The controls a panel renders for the active run. */
export interface WorkflowRunControls {
  /** Starts a run, defaulting to the current draft. Returns whether it started. */
  start(workflow?: WorkflowStartInput): boolean;
  /** Requests a cooperative pause. */
  pause(): void;
  /** Resumes a paused run. */
  resume(): void;
  /** Requests cancellation. */
  cancel(reason?: string): void;
  /** Whether the current draft may start a run. */
  canStart: boolean;
  /** The blocking validation error for the draft, or `null`. */
  blocker: string | null;
  /** The run currently shown, or `null`. */
  activeRun: WorkflowRunState | null;
}

let runCounter = 0;

function nextRunId(workflowId: string): string {
  runCounter += 1;
  return `${workflowId}-run-${runCounter}`;
}

export function useWorkflowRun(executor: WorkflowExecutor): WorkflowRunControls {
  const draft = useAtomValue(workflowDraftAtom);
  const canStart = useAtomValue(workflowReadyAtom);
  const blocker = useAtomValue(workflowBlockerAtom);
  const activeRun = useAtomValue(workflowActiveRunAtom);
  const dispatch = useSetAtom(dispatchWorkflowAtom);
  const handleRef = useRef<WorkflowRunHandle | null>(null);

  const start = useCallback(
    (workflow?: WorkflowStartInput): boolean => {
      if (workflow == null && !isDraftValid(draft)) {
        return false;
      }
      const target: WorkflowStartInput = workflow ?? {
        id: draft.id,
        name: draft.name,
        definition: draft.definition,
      };
      const runId = nextRunId(target.id);
      const callbacks: WorkflowRunCallbacks = {
        onStepStarted: (step) => dispatch({ type: 'step_started', runId, stepId: step.id }),
        onStepRetrying: (step) => dispatch({ type: 'step_retrying', runId, stepId: step.id }),
        onStepSucceeded: (result) => dispatch({ type: 'step_succeeded', runId, result }),
        onStepFailed: (result) => dispatch({ type: 'step_failed', runId, result }),
        onStepSkipped: (result) => dispatch({ type: 'step_skipped', runId, result }),
        onRunCompleted: () => dispatch({ type: 'run_completed', runId }),
        onRunFailed: (error) => dispatch({ type: 'run_failed', runId, error }),
        onRunCancelled: () => dispatch({ type: 'run_cancelled', runId }),
        onRunPaused: () => dispatch({ type: 'run_paused', runId }),
        onRunResumed: () => dispatch({ type: 'run_resumed', runId }),
      };
      dispatch({ type: 'run_started', runId });
      handleRef.current = executor.startRun(target, callbacks);
      return true;
    },
    [dispatch, draft, executor],
  );

  const pause = useCallback(() => {
    handleRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    handleRef.current?.resume();
  }, []);

  const cancel = useCallback((reason?: string) => {
    handleRef.current?.cancel(reason);
  }, []);

  return useMemo(
    () => ({ start, pause, resume, cancel, canStart, blocker, activeRun }),
    [start, pause, resume, cancel, canStart, blocker, activeRun],
  );
}
