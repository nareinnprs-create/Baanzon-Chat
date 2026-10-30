import type {
  BranchOutcome,
  CreateRunInput,
  RunWorkflowOptions,
  StepResult,
  StepRetryPolicy,
  WorkflowDefinition,
  WorkflowEngine,
  WorkflowEngineDeps,
  WorkflowEvent,
  WorkflowEventType,
  WorkflowExecutionContext,
  WorkflowResumeState,
  WorkflowRunController,
  WorkflowRunHandle,
  WorkflowRunRecord,
  WorkflowRunResult,
  WorkflowRunState,
  WorkflowStep,
  WorkflowStepType,
} from './types';

const STEP_TYPES: readonly WorkflowStepType[] = [
  'transform',
  'http',
  'tool',
  'branch',
  'delay',
  'custom',
];

export class WorkflowDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowDefinitionError';
  }
}

function normalizeRetry(value: unknown): StepRetryPolicy | undefined {
  if (value == null || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const rawAttempts = typeof record.maxAttempts === 'number' ? record.maxAttempts : 0;
  const maxAttempts = Math.floor(rawAttempts);
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1) {
    return undefined;
  }
  const policy: StepRetryPolicy = {
    maxAttempts,
    backoffMs: typeof record.backoffMs === 'number' && record.backoffMs > 0 ? record.backoffMs : 0,
  };
  if (typeof record.backoffMultiplier === 'number') {
    policy.backoffMultiplier = record.backoffMultiplier;
  }
  if (typeof record.maxBackoffMs === 'number') {
    policy.maxBackoffMs = record.maxBackoffMs;
  }
  return policy;
}

function normalizeStep(value: unknown, index: number): WorkflowStep {
  if (value == null || typeof value !== 'object') {
    throw new WorkflowDefinitionError(`Step at index ${index} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id) {
    throw new WorkflowDefinitionError(`Step at index ${index} requires a non-empty id`);
  }
  const type = record.type;
  if (typeof type !== 'string' || !STEP_TYPES.includes(type as WorkflowStepType)) {
    throw new WorkflowDefinitionError(`Step "${id}" has an unsupported type`);
  }
  const step: WorkflowStep = { id, type: type as WorkflowStepType };
  if (typeof record.name === 'string') {
    step.name = record.name;
  }
  if (record.input != null && typeof record.input === 'object') {
    step.input = record.input as Record<string, unknown>;
  }
  const retry = normalizeRetry(record.retry);
  if (retry) {
    step.retry = retry;
  }
  if (typeof record.timeoutMs === 'number' && record.timeoutMs > 0) {
    step.timeoutMs = record.timeoutMs;
  }
  if (typeof record.delayMs === 'number' && record.delayMs >= 0) {
    step.delayMs = record.delayMs;
  }
  if (typeof record.next === 'string') {
    step.next = record.next;
  }
  if (typeof record.onTrue === 'string') {
    step.onTrue = record.onTrue;
  }
  if (typeof record.onFalse === 'string') {
    step.onFalse = record.onFalse;
  }
  return step;
}

/** Validates and normalizes a raw stored graph into a runnable definition. */
export function parseWorkflowDefinition(raw: unknown): WorkflowDefinition {
  if (raw == null || typeof raw !== 'object') {
    throw new WorkflowDefinitionError('Workflow definition must be an object');
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.steps) || record.steps.length === 0) {
    throw new WorkflowDefinitionError('Workflow definition requires a non-empty steps array');
  }
  const steps = record.steps.map((value, index) => normalizeStep(value, index));

  const ids = new Set<string>();
  for (const step of steps) {
    if (ids.has(step.id)) {
      throw new WorkflowDefinitionError(`Duplicate step id: ${step.id}`);
    }
    ids.add(step.id);
  }

  for (const step of steps) {
    for (const ref of [step.next, step.onTrue, step.onFalse]) {
      if (ref != null && !ids.has(ref)) {
        throw new WorkflowDefinitionError(`Step "${step.id}" references unknown step "${ref}"`);
      }
    }
  }

  const definition: WorkflowDefinition = { steps };
  if (typeof record.version === 'number') {
    definition.version = record.version;
  }
  const defaultRetry = normalizeRetry(record.defaultRetry);
  if (defaultRetry) {
    definition.defaultRetry = defaultRetry;
  }
  return definition;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'Workflow step failed';
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Workflow aborted');
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    let settled = false;
    const cleanup = (): void => {
      if (settled) return;
      settled = true;
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      cleanup();
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function computeBackoff(policy: StepRetryPolicy | undefined, failedAttempt: number): number {
  if (!policy || policy.backoffMs <= 0) {
    return 0;
  }
  const multiplier = policy.backoffMultiplier ?? 1;
  const raw = policy.backoffMs * Math.pow(multiplier, Math.max(0, failedAttempt - 1));
  return policy.maxBackoffMs != null ? Math.min(raw, policy.maxBackoffMs) : raw;
}

function isTerminal(state: WorkflowRunState): state is WorkflowRunResult['state'] {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

class RunController implements WorkflowRunController {
  readonly runId: string;

  private readonly abortController = new AbortController();

  private paused = false;

  private cancelled = false;

  private cancelReason?: string;

  private resumeWaiters: Array<() => void> = [];

  constructor(runId: string) {
    this.runId = runId;
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get reason(): string | undefined {
    return this.cancelReason;
  }

  pause(): void {
    if (!this.cancelled) {
      this.paused = true;
    }
  }

  resume(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.releaseWaiters();
  }

  cancel(reason?: string): void {
    if (this.cancelled) {
      return;
    }
    this.cancelled = true;
    this.cancelReason = reason;
    this.paused = false;
    this.abortController.abort(reason);
    this.releaseWaiters();
  }

  isPaused(): boolean {
    return this.paused;
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  waitWhilePaused(): Promise<void> {
    if (!this.paused || this.cancelled) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.resumeWaiters.push(resolve);
    });
  }

  private releaseWaiters(): void {
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }
}

/** Selects the next step id for a completed step, or undefined to fall through. */
function selectNextStepId(step: WorkflowStep, result: StepResult): string | undefined {
  if (step.type === 'branch') {
    const outcome: BranchOutcome = result.branch === 'else' ? 'else' : 'then';
    return outcome === 'else' ? step.onFalse : step.onTrue;
  }
  return step.next;
}

export function createWorkflowEngine(deps: WorkflowEngineDeps): WorkflowEngine {
  const clock = deps.clock ?? ((): Date => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const { logger } = deps;

  function nowIso(): string {
    return clock().toISOString();
  }

  async function drive(
    options: RunWorkflowOptions,
    controller: RunController,
  ): Promise<WorkflowRunResult> {
    const { runId, workflowId, userId } = options;
    const startedAt = nowIso();
    const steps: Record<string, StepResult> = { ...(options.resume?.steps ?? {}) };
    const variables: Record<string, unknown> = {
      ...(options.variables ?? {}),
      ...(options.resume?.variables ?? {}),
    };
    let state: WorkflowRunState = 'queued';

    const emit = (type: WorkflowEventType, extra: Partial<WorkflowEvent> = {}): void => {
      const event: WorkflowEvent = {
        type,
        runId,
        workflowId,
        userId,
        state,
        at: nowIso(),
        ...extra,
      };
      try {
        deps.onEvent?.(event);
      } catch (error) {
        logger?.warn('workflow event handler failed', { error: toMessage(error) });
      }
    };

    const transition = async (
      to: WorkflowRunState,
      extra: {
        stepId?: string;
        nextStepId?: string;
        steps?: Record<string, StepResult>;
        reason?: string;
        error?: string;
      } = {},
    ): Promise<void> => {
      const from = state;
      state = to;
      await deps.runs.transition({
        runId,
        workflowId,
        userId,
        from,
        to,
        at: nowIso(),
        ...extra,
      });
    };

    const snapshot = (terminal: WorkflowRunResult['state'], error?: string): WorkflowRunResult => {
      const result: WorkflowRunResult = {
        runId,
        workflowId,
        userId,
        state: terminal,
        steps: { ...steps },
        startedAt,
        finishedAt: nowIso(),
      };
      if (error !== undefined) {
        result.error = error;
      }
      return result;
    };

    const finalizeCancelled = async (): Promise<WorkflowRunResult> => {
      await transition('cancelled', {
        reason: controller.reason,
        steps: { ...steps },
      });
      emit('run.cancelled', { message: controller.reason });
      return snapshot('cancelled', controller.reason);
    };

    const executeAttempt = async (
      step: WorkflowStep,
      attempt: number,
      timeoutMs: number | undefined,
    ): Promise<StepResult> => {
      const attemptController = new AbortController();
      const onAbort = (): void => attemptController.abort(controller.signal.reason);
      if (controller.signal.aborted) {
        attemptController.abort(controller.signal.reason);
      } else {
        controller.signal.addEventListener('abort', onAbort, { once: true });
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const context: WorkflowExecutionContext = {
          runId,
          workflowId,
          userId,
          step,
          steps,
          variables,
          attempt,
          signal: attemptController.signal,
        };
        const execution = deps.executor.execute(context);
        if (timeoutMs == null || timeoutMs <= 0) {
          return await execution;
        }
        return await Promise.race([
          execution,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              attemptController.abort(new Error(`Step "${step.id}" timed out`));
              reject(new Error(`Step "${step.id}" timed out after ${timeoutMs}ms`));
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        controller.signal.removeEventListener('abort', onAbort);
      }
    };

    const runStep = async (
      step: WorkflowStep,
      defaultRetry: StepRetryPolicy | undefined,
    ): Promise<StepResult> => {
      const stepStartedAt = nowIso();
      const started = clock().getTime();

      if (step.type === 'delay') {
        emit('step.started', { stepId: step.id, attempt: 1 });
        const delayMs = step.delayMs ?? 0;
        try {
          if (delayMs > 0) {
            await sleep(delayMs, controller.signal);
          }
        } catch (error) {
          return {
            stepId: step.id,
            status: 'failed',
            error: toMessage(error),
            attempts: 1,
            startedAt: stepStartedAt,
            finishedAt: nowIso(),
            durationMs: Math.max(0, clock().getTime() - started),
          };
        }
        emit('step.succeeded', { stepId: step.id, attempt: 1 });
        return {
          stepId: step.id,
          status: 'succeeded',
          attempts: 1,
          startedAt: stepStartedAt,
          finishedAt: nowIso(),
          durationMs: Math.max(0, clock().getTime() - started),
        };
      }

      const retry = step.retry ?? defaultRetry;
      const maxAttempts = retry?.maxAttempts ?? 1;
      const timeoutMs = step.timeoutMs;
      let lastError: string | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (controller.isCancelled()) {
          return {
            stepId: step.id,
            status: 'failed',
            error: controller.reason ?? 'cancelled',
            attempts: Math.max(0, attempt - 1),
            startedAt: stepStartedAt,
            finishedAt: nowIso(),
            durationMs: Math.max(0, clock().getTime() - started),
          };
        }
        emit('step.started', { stepId: step.id, attempt });
        try {
          const executed = await executeAttempt(step, attempt, timeoutMs);
          if (executed.status === 'failed') {
            throw new Error(executed.error ?? `Step "${step.id}" failed`);
          }
          return {
            ...executed,
            stepId: step.id,
            attempts: attempt,
            startedAt: executed.startedAt ?? stepStartedAt,
            finishedAt: nowIso(),
            durationMs: Math.max(0, clock().getTime() - started),
          };
        } catch (error) {
          lastError = toMessage(error);
          if (controller.isCancelled()) {
            return {
              stepId: step.id,
              status: 'failed',
              error: controller.reason ?? lastError,
              attempts: attempt,
              startedAt: stepStartedAt,
              finishedAt: nowIso(),
              durationMs: Math.max(0, clock().getTime() - started),
            };
          }
          const hasMore = attempt < maxAttempts;
          if (!hasMore) {
            emit('step.failed', { stepId: step.id, attempt, message: lastError });
            break;
          }
          emit('step.retrying', { stepId: step.id, attempt, message: lastError });
          const backoff = computeBackoff(retry, attempt);
          if (backoff > 0) {
            try {
              await sleep(backoff, controller.signal);
            } catch (sleepError) {
              lastError = toMessage(sleepError);
              break;
            }
          }
        }
      }

      return {
        stepId: step.id,
        status: 'failed',
        error: lastError,
        attempts: maxAttempts,
        startedAt: stepStartedAt,
        finishedAt: nowIso(),
        durationMs: Math.max(0, clock().getTime() - started),
      };
    };

    try {
      let created: WorkflowRunRecord;
      try {
        const input: CreateRunInput = { runId, workflowId, userId, metadata: options.metadata };
        created = await deps.runs.createRun(input);
      } catch (error) {
        logger?.error('workflow run could not be created', {
          runId,
          error: toMessage(error),
        });
        return snapshot('failed', toMessage(error));
      }
      state = created.state;

      if (isTerminal(created.state) && !options.resume) {
        return {
          runId,
          workflowId,
          userId,
          state: created.state,
          steps: created.steps ?? { ...steps },
          error: created.error,
          startedAt,
          finishedAt: nowIso(),
        };
      }

      emit('run.queued');

      if (controller.isCancelled()) {
        return finalizeCancelled();
      }

      const workflow = await deps.workflows.getWorkflow(workflowId);
      if (!workflow) {
        await transition('failed', { error: 'workflow_not_found' });
        emit('run.failed', { message: 'workflow_not_found' });
        return snapshot('failed', 'workflow_not_found');
      }
      if (!workflow.enabled) {
        await transition('failed', { error: 'workflow_disabled' });
        emit('run.failed', { message: 'workflow_disabled' });
        return snapshot('failed', 'workflow_disabled');
      }

      let definition: WorkflowDefinition;
      try {
        definition = parseWorkflowDefinition(workflow.definition);
      } catch (error) {
        const message = toMessage(error);
        await transition('failed', { error: message });
        emit('run.failed', { message });
        return snapshot('failed', message);
      }

      const indexById = new Map<string, number>();
      definition.steps.forEach((step, index) => indexById.set(step.id, index));

      let index = 0;
      if (options.resume) {
        const resumeState: WorkflowResumeState = options.resume;
        const found = indexById.get(resumeState.startAtStepId);
        if (found == null) {
          const message = `resume step "${resumeState.startAtStepId}" not found`;
          await transition('failed', { error: message });
          emit('run.failed', { message });
          return snapshot('failed', message);
        }
        index = found;
      }

      await transition('running');
      emit('run.started');

      while (index >= 0 && index < definition.steps.length) {
        if (controller.isCancelled()) {
          return finalizeCancelled();
        }

        if (controller.isPaused()) {
          const nextStep = definition.steps[index];
          await transition('paused', { nextStepId: nextStep.id, steps: { ...steps } });
          emit('run.paused');
          await controller.waitWhilePaused();
          if (controller.isCancelled()) {
            return finalizeCancelled();
          }
          await transition('running');
          emit('run.resumed');
        }

        const step = definition.steps[index];
        const result = await runStep(step, definition.defaultRetry);

        if (controller.isCancelled()) {
          return finalizeCancelled();
        }

        steps[step.id] = result;
        await deps.runs.recordStep({ runId, workflowId, userId, result, at: nowIso() });

        if (result.status === 'skipped') {
          emit('step.skipped', { stepId: step.id, attempt: result.attempts });
        } else if (result.status === 'succeeded') {
          emit('step.succeeded', { stepId: step.id, attempt: result.attempts });
        }

        if (result.status === 'failed') {
          await transition('failed', { stepId: step.id, steps: { ...steps }, error: result.error });
          emit('run.failed', { stepId: step.id, message: result.error });
          return snapshot('failed', result.error);
        }

        const nextId = selectNextStepId(step, result);
        if (nextId == null) {
          index += 1;
        } else {
          const nextIndex = indexById.get(nextId);
          index = nextIndex == null ? -1 : nextIndex;
        }
      }

      await transition('completed', { steps: { ...steps } });
      emit('run.completed');
      return snapshot('completed');
    } catch (error) {
      const message = toMessage(error);
      logger?.error('workflow run failed unexpectedly', { runId, error: message });
      try {
        await transition('failed', { error: message, steps: { ...steps } });
        emit('run.failed', { message });
      } catch (transitionError) {
        logger?.warn('workflow failure transition could not be persisted', {
          runId,
          error: toMessage(transitionError),
        });
      }
      return snapshot('failed', message);
    }
  }

  function start(options: RunWorkflowOptions): WorkflowRunHandle {
    const controller = new RunController(options.runId);
    const completion = drive(options, controller);
    return { runId: options.runId, controller, completion };
  }

  return {
    start,
    run(options: RunWorkflowOptions): Promise<WorkflowRunResult> {
      return start(options).completion;
    },
  };
}
