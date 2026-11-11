import type { WorkflowExecutionContext, WorkflowStep } from './types';
import { createLocalWorkflowExecutor } from './localExecutor';
import type { LocalWorkflowExecutorOptions } from './localExecutor';
import { describe, expect, it } from '@jest/globals';

function makeContext(
  step: Pick<WorkflowStep, 'id' | 'type' | 'input'>,
  variables: Record<string, unknown> = {},
): WorkflowExecutionContext {
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    userId: 'user-1',
    step: { ...step, id: step.id } as WorkflowStep,
    steps: {},
    variables,
    attempt: 1,
    signal: new AbortController().signal,
  };
}

const okFetch = (body: unknown, status = 200, contentType = 'application/json') =>
  (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'X',
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    }) as unknown as Response);

describe('createLocalWorkflowExecutor', () => {
  it('runs http steps and parses JSON responses', async () => {
    const executor = createLocalWorkflowExecutor({
      fetchImpl: okFetch({ answer: 42 }) as unknown as typeof fetch,
    });
    const result = await executor.execute(
      makeContext({ id: 'fetch', type: 'http', input: { url: 'https://x.test/api' } }),
    );
    expect(result.status).toBe('succeeded');
    expect(result.output).toEqual({ answer: 42 });
  });

  it('fails http steps on non-2xx with the status code', async () => {
    const executor = createLocalWorkflowExecutor({
      fetchImpl: okFetch('nope', 503, 'text/plain') as unknown as typeof fetch,
    });
    const result = await executor.execute(
      makeContext({ id: 'fetch', type: 'http', input: { url: 'https://x.test/api' } }),
    );
    expect(result.status).toBe('failed');
    expect(result.error).toContain('503');
  });

  it('rejects non-http urls', async () => {
    const executor = createLocalWorkflowExecutor({
      fetchImpl: okFetch({}) as unknown as typeof fetch,
    });
    const result = await executor.execute(
      makeContext({ id: 'fetch', type: 'http', input: { url: 'file:///etc/passwd' } }),
    );
    expect(result.status).toBe('failed');
    expect(result.error).toContain('http(s)');
  });

  it('merges transform set into variables and emits the result', async () => {
    const executor = createLocalWorkflowExecutor();
    const variables: Record<string, unknown> = { count: 1 };
    const result = await executor.execute(
      makeContext(
        { id: 't', type: 'transform', input: { set: { flag: true }, result: { done: true } } },
        variables,
      ),
    );
    expect(result.status).toBe('succeeded');
    expect(result.output).toEqual({ done: true });
    expect(variables.flag).toBe(true);
  });

  it('branches then/else by comparing a variable', async () => {
    const executor = createLocalWorkflowExecutor();
    const then = await executor.execute(
      makeContext({ id: 'b', type: 'branch', input: { variable: 'flag', equals: true } }, { flag: true }),
    );
    expect(then.branch).toBe('then');
    const els = await executor.execute(
      makeContext({ id: 'b', type: 'branch', input: { variable: 'flag', equals: true } }, { flag: false }),
    );
    expect(els.branch).toBe('else');
  });

  it('fails tool and custom steps as unsupported', async () => {
    const executor = createLocalWorkflowExecutor();
    for (const type of ['tool', 'custom'] as const) {
      const result = await executor.execute(makeContext({ id: 'x', type }));
      expect(result.status).toBe('failed');
      expect(result.error).toContain(type);
    }
  });
});
