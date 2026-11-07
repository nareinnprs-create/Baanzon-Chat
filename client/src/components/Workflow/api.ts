import type { StepResult, WorkflowStartInput, WorkflowStep } from './types';

/**
 * The single seam between the Workflow Builder view and whatever executes a
 * run. The view is written against this interface and receives an
 * implementation as a prop, so it never imports a transport, a data-provider
 * endpoint or a React Query hook. A real backend adapter and the in-memory
 * reference below are interchangeable.
 *
 * Mirrors the backend `WorkflowExecutor`/`WorkflowRunController` pairing in
 * `packages/api/src/workflows/types.ts`, flattened for the client: one call
 * starts the run and returns the cooperative controls.
 */

/** What a started run reports back to the view, one call per event. */
export interface WorkflowRunCallbacks {
  onStepStarted?(step: WorkflowStep): void;
  onStepRetrying?(step: WorkflowStep): void;
  onStepSucceeded?(result: StepResult): void;
  onStepFailed?(result: StepResult): void;
  onStepSkipped?(result: StepResult): void;
  onRunCompleted?(): void;
  onRunFailed?(error: string): void;
  onRunCancelled?(reason?: string): void;
  onRunPaused?(): void;
  onRunResumed?(): void;
}

/** Cooperative controls for an in-flight run, returned by `startRun`. */
export interface WorkflowRunHandle {
  /** Requests a cooperative pause; effective at the next step boundary. */
  pause(): void;
  /** Resumes a paused run. */
  resume(): void;
  /** Requests cancellation; implementations reject promptly once observed. */
  cancel(reason?: string): void;
}

/**
 * The injected executor: takes the workflow definition plus callbacks and
 * returns the run controls. Implementations decide how a step actually runs;
 * the view only owns state transitions driven by the callbacks.
 */
export interface WorkflowExecutor {
  startRun(workflow: WorkflowStartInput, callbacks: WorkflowRunCallbacks): WorkflowRunHandle;
}

export type InMemoryExecutorOptions = {
  /** Artificial latency per step; makes progress states observable. */
  stepDelayMs?: number;
  /** Step ids that fail when run, so failure paths are exercisable. */
  failStepIds?: string[];
  /** Step ids reported as skipped, e.g. unselected branch edges. */
  skipStepIds?: string[];
};

const DEFAULT_STEP_DELAY_MS = 60;

function abortError(): Error {
  const error = new Error('Workflow run aborted');
  error.name = 'AbortError';
  return error;
}

function sleep(ms: number, signal: { aborted: boolean }): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      clearInterval(poll);
      resolve();
    }, ms);
    const poll = setInterval(
      () => {
        if (signal.aborted) {
          clearTimeout(timer);
          clearInterval(poll);
          reject(abortError());
        }
      },
      Math.min(ms, 10),
    );
  });
}

function makeResult(step: WorkflowStep, status: StepResult['status']): StepResult {
  const now = new Date().toISOString();
  return {
    stepId: step.id,
    status,
    attempts: 1,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    error: status === 'failed' ? `Step "${step.id}" failed` : undefined,
  };
}

/** Live control flags shared between the handle and the driving loop. */
type RunFlags = { paused: boolean; cancelled: boolean };

/**
 * A deterministic, dependency-free reference executor.
 *
 * It exists so the view and its tests can run a complete flow without a
 * backend, and so integrators have a working default to swap out. Steps run in
 * document order with cooperative pause between steps; cancellation aborts the
 * in-flight delay.
 */
export function createInMemoryExecutor(options: InMemoryExecutorOptions = {}): WorkflowExecutor {
  const stepDelayMs = options.stepDelayMs ?? DEFAULT_STEP_DELAY_MS;
  const failStepIds = new Set(options.failStepIds ?? []);
  const skipStepIds = new Set(options.skipStepIds ?? []);

  return {
    startRun(workflow, callbacks) {
      const flags: RunFlags = { paused: false, cancelled: false };
      const abortSignal = {
        get aborted() {
          return flags.cancelled;
        },
      };

      const waitWhilePaused = async (): Promise<void> => {
        while (flags.paused && !flags.cancelled) {
          await sleep(10, abortSignal);
        }
      };

      void (async () => {
        try {
          for (const step of workflow.definition.steps) {
            if (flags.cancelled) {
              return;
            }
            await waitWhilePaused();
            if (flags.cancelled) {
              return;
            }
            callbacks.onStepStarted?.(step);
            await sleep(stepDelayMs, abortSignal);
            if (flags.cancelled) {
              return;
            }
            if (skipStepIds.has(step.id)) {
              callbacks.onStepSkipped?.(makeResult(step, 'skipped'));
              continue;
            }
            if (failStepIds.has(step.id)) {
              callbacks.onStepFailed?.(makeResult(step, 'failed'));
              callbacks.onRunFailed?.(`Step "${step.id}" failed`);
              return;
            }
            callbacks.onStepSucceeded?.(makeResult(step, 'succeeded'));
          }
          if (!flags.cancelled) {
            callbacks.onRunCompleted?.();
          }
        } catch {
          if (flags.cancelled) {
            callbacks.onRunCancelled?.();
          }
        }
      })();

      return {
        pause() {
          flags.paused = true;
          callbacks.onRunPaused?.();
        },
        resume() {
          flags.paused = false;
          callbacks.onRunResumed?.();
        },
        cancel(reason?: string) {
          if (flags.cancelled) {
            return;
          }
          flags.cancelled = true;
          callbacks.onRunCancelled?.(reason);
        },
      };
    },
  };
}
