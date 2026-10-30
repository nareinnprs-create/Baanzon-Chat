/**
 * Client-side mirror of the workflow contracts in `packages/api/src/workflows`.
 *
 * The client cannot import `@librechat/api` (backend-only workspace), so these
 * types deliberately duplicate the backend shapes: `WorkflowStepType`,
 * `WorkflowStep`, `WorkflowDefinition`, `StepRetryPolicy`, `WorkflowRunState`
 * and `StepResult` match `packages/api/src/workflows/types.ts` field for field.
 * A drift between the two is caught by comparing this file against the backend
 * `types.ts`.
 */

/** Step kinds accepted by the backend engine, in the same order. */
export type WorkflowStepType = 'transform' | 'http' | 'tool' | 'branch' | 'delay' | 'custom';

/** Retry policy for one step; mirrors `StepRetryPolicy`. */
export interface StepRetryPolicy {
  /** Total attempts including the first. */
  maxAttempts: number;
  /** Backoff before the second attempt, ms. */
  backoffMs: number;
  /** Multiplier applied per additional attempt; defaults to 1 (constant). */
  backoffMultiplier?: number;
  /** Ceiling for a single backoff interval, ms. */
  maxBackoffMs?: number;
}

/** One step in the graph; mirrors backend `WorkflowStep`. */
export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  name?: string;
  /** Arbitrary step configuration forwarded verbatim to the executor. */
  input?: Record<string, unknown>;
  /** Retry policy for this step; falls back to the definition default. */
  retry?: StepRetryPolicy;
  /** Abort budget for a single attempt, ms. */
  timeoutMs?: number;
  /** Cooperative wait for a `delay` step, ms. */
  delayMs?: number;
  /** Explicit next step; defaults to the following step in document order. */
  next?: string;
  /** `branch` step: step id to run when the executor reports `then`. */
  onTrue?: string;
  /** `branch` step: step id to run when the executor reports `else`. */
  onFalse?: string;
}

/** The graph document; mirrors backend `WorkflowDefinition`. */
export interface WorkflowDefinition {
  version?: number;
  /** Retry policy applied to steps without their own. */
  defaultRetry?: StepRetryPolicy;
  /** Ordered steps; execution follows document order unless a step redirects. */
  steps: WorkflowStep[];
}

/** Run lifecycle; mirrors backend `WorkflowRunState`. */
export type WorkflowRunState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Terminal run states; mirrors backend `WorkflowTerminalState`. */
export type WorkflowTerminalState = Extract<WorkflowRunState, 'completed' | 'failed' | 'cancelled'>;

/** Branch edge selected by a `branch` step; mirrors backend `BranchOutcome`. */
export type BranchOutcome = 'then' | 'else';

/** Backend step outcome; mirrors backend `StepStatus`. */
export type WorkflowStepResultStatus = 'succeeded' | 'failed' | 'skipped';

/** Per-step result; mirrors backend `StepResult`. */
export interface StepResult {
  stepId: string;
  status: WorkflowStepResultStatus;
  /** Step output, forwarded to downstream steps through the context. */
  output?: unknown;
  /** Branch edge selected by a `branch` step executor. */
  branch?: BranchOutcome;
  /** Failure detail when `status` is `failed`. */
  error?: string;
  /** Attempts consumed, including the first. */
  attempts: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

/**
 * Per-step status for UI display. Extends the backend vocabulary with the UI
 * lifecycle: `pending` before the step starts, `running` while in flight and
 * `paused` while the run is paused; `completed` maps to `succeeded`.
 */
export type WorkflowStepDisplayStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'skipped';

/** The editable workflow document held by the builder draft. */
export interface WorkflowDraft {
  id: string;
  name: string;
  description: string;
  definition: WorkflowDefinition;
}

/**
 * Identity plus graph, as handed to a `WorkflowExecutor` to start a run. The
 * executor receives this rather than a full draft so transport adapters never
 * depend on builder-only fields such as `description`.
 */
export interface WorkflowStartInput {
  id: string;
  name?: string;
  definition: WorkflowDefinition;
}

/** One entry in the run history list. */
export interface WorkflowRunSummary {
  runId: string;
  state: WorkflowRunState;
  startedAt: string;
  finishedAt?: string;
  /** Normalised progress in the range 0..1. */
  progress: number;
  error?: string;
}
