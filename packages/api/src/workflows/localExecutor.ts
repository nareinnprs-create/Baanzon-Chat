import type {
  StepResult,
  WorkflowExecutionContext,
  WorkflowExecutor,
} from './types';

/**
 * Local step executor: runs every effect this deployment can honor natively —
 * `http` (fetch with the attempt signal), `transform` (variable merge) and
 * `branch` (variable comparison) — and fails `tool`/`custom` steps with a
 * clear unsupported error until a tool runtime is paired.
 *
 * `transform` input: `{ set?: Record<string, unknown>, result?: unknown }` —
 * `set` merges into the run variables, and the step output is `result` when
 * provided, otherwise a shallow copy of the variables after the merge.
 * `branch` input: `{ variable: string, equals?: unknown }` — the edge is
 * `then` when the variable deep-equals `equals` (default `true`), else `else`.
 * `http` input: `{ url, method?, headers?, body?, json? }` — non-2xx responses
 * fail the step; JSON responses are parsed into the step output.
 */
export interface LocalWorkflowExecutorOptions {
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

function nowIso(): string {
  return new Date().toISOString();
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function baseResult(ctx: WorkflowExecutionContext): StepResult {
  const startedAt = nowIso();
  return {
    stepId: ctx.step.id,
    status: 'succeeded',
    attempts: ctx.attempt,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
  };
}

async function executeHttp(
  ctx: WorkflowExecutionContext,
  fetchImpl: typeof fetch,
): Promise<StepResult> {
  const input = (ctx.step.input ?? {}) as {
    url?: unknown;
    method?: unknown;
    headers?: Record<string, string>;
    body?: unknown;
    json?: unknown;
  };
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) {
    return {
      ...baseResult(ctx),
      status: 'failed',
      error: 'http step requires an absolute http(s) "url" in the step input',
    };
  }
  const method = typeof input.method === 'string' ? input.method.toUpperCase() : 'GET';
  const useJson = input.json === true;
  const body =
    input.body === undefined
      ? undefined
      : useJson || (input.body != null && typeof input.body === 'object')
        ? JSON.stringify(input.body)
        : String(input.body);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: input.headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      signal: ctx.signal,
    });
  } catch (error) {
    if (ctx.signal.aborted) {
      throw error;
    }
    return {
      ...baseResult(ctx),
      status: 'failed',
      error: `http step request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  let output: unknown = text;
  if (useJson || contentType.includes('json')) {
    try {
      output = JSON.parse(text) as unknown;
    } catch {
      // keep the raw text as the output
    }
  }

  if (!response.ok) {
    return {
      ...baseResult(ctx),
      status: 'failed',
      error: `HTTP ${response.status} ${response.statusText}`,
      output,
    };
  }
  return { ...baseResult(ctx), output };
}

function executeTransform(ctx: WorkflowExecutionContext): StepResult {
  const input = (ctx.step.input ?? {}) as {
    set?: Record<string, unknown>;
    result?: unknown;
  };
  if (input.set != null && typeof input.set === 'object') {
    Object.assign(ctx.variables, input.set);
  }
  const output =
    input.result !== undefined ? input.result : { ...ctx.variables };
  return { ...baseResult(ctx), output };
}

function executeBranch(ctx: WorkflowExecutionContext): StepResult {
  const input = (ctx.step.input ?? {}) as {
    variable?: unknown;
    equals?: unknown;
  };
  const variable = typeof input.variable === 'string' ? input.variable : '';
  const expected = input.equals === undefined ? true : input.equals;
  const actual = variable !== '' ? ctx.variables[variable] : undefined;
  const edge = deepEqual(actual, expected) ? 'then' : 'else';
  return { ...baseResult(ctx), branch: edge, output: { variable, edge } };
}

export function createLocalWorkflowExecutor(
  options: LocalWorkflowExecutorOptions = {},
): WorkflowExecutor {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async execute(context: WorkflowExecutionContext): Promise<StepResult> {
      switch (context.step.type) {
        case 'http':
          return executeHttp(context, fetchImpl);
        case 'transform':
          return executeTransform(context);
        case 'branch':
          return executeBranch(context);
        case 'delay':
          // The engine handles delay natively before reaching the executor.
          return baseResult(context);
        case 'tool':
        case 'custom':
          return {
            ...baseResult(context),
            status: 'failed',
            error: `Step type "${context.step.type}" needs a paired tool runtime, which this deployment does not provide`,
          };
        default:
          return {
            ...baseResult(context),
            status: 'failed',
            error: `Unsupported step type "${String(context.step.type)}"`,
          };
      }
    },
  };
}
