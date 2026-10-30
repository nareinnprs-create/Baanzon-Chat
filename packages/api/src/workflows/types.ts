/**
 * Types for the workflow orchestration engine (blueprint §45).
 *
 * Everything external — HTTP, tool calls, transforms, persistence — is reached
 * through an injected port so the engine performs no direct I/O and a second
 * implementation is a new argument rather than a new branch.
 */

export type WorkflowStepType = 'transform' | 'http' | 'tool' | 'branch' | 'delay' | 'custom';

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

export interface WorkflowDefinition {
  version?: number;
  /** Retry policy applied to steps without their own. */
  defaultRetry?: StepRetryPolicy;
  /** Ordered steps; execution follows document order unless a step redirects. */
  steps: WorkflowStep[];
}

export type WorkflowRunState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type WorkflowTerminalState = Extract<WorkflowRunState, 'completed' | 'failed' | 'cancelled'>;

export type BranchOutcome = 'then' | 'else';

export type StepStatus = 'succeeded' | 'failed' | 'skipped';

export interface StepResult {
  stepId: string;
  status: StepStatus;
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

export type WorkflowEventType =
  | 'run.queued'
  | 'run.started'
  | 'run.paused'
  | 'run.resumed'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'step.started'
  | 'step.retrying'
  | 'step.succeeded'
  | 'step.failed'
  | 'step.skipped';

export interface WorkflowEvent {
  type: WorkflowEventType;
  runId: string;
  workflowId: string;
  userId: string;
  state: WorkflowRunState;
  at: string;
  stepId?: string;
  attempt?: number;
  message?: string;
  data?: Record<string, unknown>;
}

/**
 * Consumable lifecycle hook: the engine invokes it synchronously for every
 * emitted {@link WorkflowEvent}, and swallows synchronous throws so an observer
 * can never abort a run. Async observers must contain their own rejections.
 */
export type WorkflowEventHandler = (event: WorkflowEvent) => void;

export interface WorkflowExecutionContext {
  runId: string;
  workflowId: string;
  userId: string;
  step: WorkflowStep;
  /** Results of steps that already ran, keyed by step id. */
  steps: Record<string, StepResult>;
  /** Mutable run variables carried between steps. */
  variables: Record<string, unknown>;
  /** Attempt index, starting at 1. */
  attempt: number;
  /** Cooperative cancellation/timeout signal for this attempt. */
  signal: AbortSignal;
}

/**
 * The single seam for external effects. Implementations run one attempt of a
 * step and either resolve or throw; the engine owns retry, backoff and timeouts.
 */
export interface WorkflowExecutor {
  execute(context: WorkflowExecutionContext): Promise<StepResult>;
}

export interface WorkflowLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface StoredWorkflow {
  id: string;
  enabled: boolean;
  /** Raw graph; normalized by the engine via `parseWorkflowDefinition`. */
  definition?: Record<string, unknown>;
}

export interface WorkflowStore {
  getWorkflow(workflowId: string): Promise<StoredWorkflow | null>;
}

export interface WorkflowRunRecord {
  runId: string;
  workflowId: string;
  userId: string;
  state: WorkflowRunState;
  /** Step results persisted so far, enabling cross-process resume. */
  steps?: Record<string, StepResult>;
  /** The step a paused run should resume at. */
  nextStepId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateRunInput {
  runId: string;
  workflowId: string;
  userId: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowRunTransition {
  runId: string;
  workflowId: string;
  userId: string;
  to: WorkflowRunState;
  from?: WorkflowRunState;
  at: string;
  reason?: string;
  stepId?: string;
  nextStepId?: string;
  steps?: Record<string, StepResult>;
  error?: string;
}

export interface WorkflowStepRecord {
  runId: string;
  workflowId: string;
  userId: string;
  result: StepResult;
  at: string;
}

export interface WorkflowRunStore {
  /** Creates the run at `queued`, or returns the existing row for a repeated runId. */
  createRun(input: CreateRunInput): Promise<WorkflowRunRecord>;
  getRun(userId: string, runId: string): Promise<WorkflowRunRecord | null>;
  /** Persists a single run state transition. */
  transition(input: WorkflowRunTransition): Promise<WorkflowRunRecord>;
  /** Persists one concluded step result. */
  recordStep(input: WorkflowStepRecord): Promise<void>;
}

export interface WorkflowEngineDeps {
  workflows: WorkflowStore;
  runs: WorkflowRunStore;
  executor: WorkflowExecutor;
  /** Injected clock; defaults to `() => new Date()`. */
  clock?: () => Date;
  /** Injected timer for backoff/delay; defaults to an abortable setTimeout. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  logger?: WorkflowLogger;
  /** Observes lifecycle events; never used for persistence. */
  onEvent?: WorkflowEventHandler;
}

export interface WorkflowResumeState {
  startAtStepId: string;
  steps: Record<string, StepResult>;
  variables?: Record<string, unknown>;
}

export interface RunWorkflowOptions {
  runId: string;
  workflowId: string;
  userId: string;
  metadata?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  /** Continue a paused run from a persisted checkpoint. */
  resume?: WorkflowResumeState;
}

export interface WorkflowRunController {
  readonly runId: string;
  /** Requests a cooperative pause; effective at the next step boundary. */
  pause(): void;
  /** Resumes a paused run. */
  resume(): void;
  /** Requests cancellation; aborts the in-flight attempt. */
  cancel(reason?: string): void;
  isPaused(): boolean;
  isCancelled(): boolean;
  /** Aborted when cancellation is requested. */
  readonly signal: AbortSignal;
}

export interface WorkflowRunHandle {
  runId: string;
  controller: WorkflowRunController;
  completion: Promise<WorkflowRunResult>;
}

export interface WorkflowRunResult {
  runId: string;
  workflowId: string;
  userId: string;
  state: WorkflowTerminalState;
  steps: Record<string, StepResult>;
  error?: string;
  startedAt: string;
  finishedAt: string;
}

export interface WorkflowEngine {
  start(options: RunWorkflowOptions): WorkflowRunHandle;
  run(options: RunWorkflowOptions): Promise<WorkflowRunResult>;
}

export type WorkflowTrigger =
  | { type: 'manual' }
  | { type: 'once'; at: string }
  | { type: 'interval'; everyMs: number; anchor?: string }
  | { type: 'cron'; expression: string; timezone?: string };

export interface WorkflowSchedulerDeps {
  /** Injected clock; defaults to `() => new Date()`. */
  clock?: () => Date;
  /** Required for `cron` triggers: next occurrence strictly after `after`. */
  nextCronRun?: (expression: string, after: Date, timezone?: string) => Date | null;
}

export interface WorkflowScheduler {
  /** Next fire instant strictly after `after` (defaults to the injected clock now). */
  nextRun(trigger: WorkflowTrigger, after?: Date): Date | null;
  /** Whether the trigger is due, given when it last ran (`null` when never run). */
  isDue(trigger: WorkflowTrigger, lastRunAt: Date | null): boolean;
}
