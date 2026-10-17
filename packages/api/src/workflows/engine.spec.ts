import type {
  CreateRunInput,
  StepResult,
  WorkflowEvent,
  WorkflowExecutionContext,
  WorkflowRunRecord,
  WorkflowRunTransition,
  WorkflowStepRecord,
} from './types';
import { createWorkflowEngine } from './engine';

function makeRunStore() {
  const transitions: WorkflowRunTransition[] = [];
  const stepRecords: WorkflowStepRecord[] = [];
  let record: WorkflowRunRecord = {
    runId: 'r1',
    workflowId: 'wf-1',
    userId: 'u1',
    state: 'queued',
    steps: {},
  };
  return {
    transitions,
    stepRecords,
    get record() {
      return record;
    },
    async createRun(input: CreateRunInput) {
      record = { ...record, ...input, state: 'queued' };
      return record;
    },
    async getRun() {
      return record;
    },
    async transition(input: WorkflowRunTransition) {
      transitions.push(input);
      record = { ...record, state: input.to, steps: input.steps ?? record.steps };
      return record;
    },
    async recordStep(input: WorkflowStepRecord) {
      stepRecords.push(input);
    },
  };
}

function makeWorkflowStore(definition: Record<string, unknown>, enabled = true) {
  return {
    async getWorkflow() {
      return { id: 'wf-1', enabled, definition };
    },
  };
}

const ok = async (ctx: WorkflowExecutionContext): Promise<StepResult> => ({
  stepId: ctx.step.id,
  status: 'succeeded',
  output: { ran: ctx.step.id },
  attempts: ctx.attempt,
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:01.000Z',
  durationMs: 1000,
});

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function delayResolver() {
  let resolveFn: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  return { promise, resolve: resolveFn! };
}

describe('engine', () => {
  it('executes happy path in order', async () => {
    const definition = {
      steps: [
        { id: 's1', type: 'transform' },
        { id: 's2', type: 'transform' },
        { id: 's3', type: 'transform' },
      ],
    };
    const runs = makeRunStore();
    const workflows = makeWorkflowStore(definition);
    const events: WorkflowEvent[] = [];
    const engine = createWorkflowEngine({
      workflows,
      runs,
      executor: { execute: ok },
      onEvent: (e) => events.push(e),
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const result = await engine.run({ runId: 'r1', workflowId: 'wf-1', userId: 'u1' });
    expect(result.state).toBe('completed');
    expect(Object.keys(result.steps)).toEqual(['s1', 's2', 's3']);
    expect(runs.transitions.map((t) => t.to)).toEqual(['running', 'completed']);
    expect(runs.stepRecords.length).toBe(3);
  });

  it('fails a step with retry exhaustion', async () => {
    const definition = {
      steps: [{ id: 's1', type: 'transform', retry: { maxAttempts: 2, backoffMs: 0 } }],
    };
    const runs = makeRunStore();
    const workflows = makeWorkflowStore(definition);
    let attempts = 0;
    const engine = createWorkflowEngine({
      workflows,
      runs,
      executor: {
        execute: () => {
          attempts++;
          throw new Error('boom');
        },
      },
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
      sleep: async () => {},
    });
    const result = await engine.run({ runId: 'r1', workflowId: 'wf-1', userId: 'u1' });
    expect(attempts).toBe(2);
    expect(result.state).toBe('failed');
    expect(result.error).toContain('boom');
  });

  it('retries then succeeds', async () => {
    const definition = {
      steps: [{ id: 's1', type: 'transform', retry: { maxAttempts: 3, backoffMs: 0 } }],
    };
    const runs = makeRunStore();
    const workflows = makeWorkflowStore(definition);
    let attempts = 0;
    const engine = createWorkflowEngine({
      workflows,
      runs,
      executor: {
        execute: (ctx) => {
          attempts++;
          if (attempts < 3) throw new Error('boom');
          return ok({ ...ctx, attempt: attempts });
        },
      },
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
      sleep: async () => {},
    });
    const result = await engine.run({ runId: 'r1', workflowId: 'wf-1', userId: 'u1' });
    expect(attempts).toBe(3);
    expect(result.state).toBe('completed');
    expect(result.steps.s1.attempts).toBe(3);
  });

  it('branches based on result', async () => {
    const definition = {
      steps: [
        { id: 'a', type: 'branch', onTrue: 'b', onFalse: 'c' },
        { id: 'b', type: 'transform' },
        { id: 'c', type: 'transform' },
      ],
    };
    const runs = makeRunStore();
    const workflows = makeWorkflowStore(definition);
    const engine = createWorkflowEngine({
      workflows,
      runs,
      executor: {
        execute: async (ctx) => {
          if (ctx.step.id === 'a') {
            return {
              stepId: 'a',
              status: 'succeeded' as const,
              branch: 'else' as const,
              attempts: ctx.attempt,
              startedAt: '2026-01-01T00:00:00.000Z',
              finishedAt: '2026-01-01T00:00:01.000Z',
              durationMs: 1000,
            };
          }
          return ok(ctx);
        },
      },
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
      sleep: async () => {},
    });
    const result = await engine.run({ runId: 'r1', workflowId: 'wf-1', userId: 'u1' });
    expect(result.state).toBe('completed');
    expect(result.steps.b).toBeUndefined();
    expect(result.steps.c).toBeDefined();
  });

  it('pauses then resumes mid-run', async () => {
    const definition = {
      steps: [
        { id: 's1', type: 'transform' },
        { id: 's2', type: 'transform' },
      ],
    };
    const runs = makeRunStore();
    const workflows = makeWorkflowStore(definition);
    const first = delayResolver();
    const started: string[] = [];
    const engine = createWorkflowEngine({
      workflows,
      runs,
      executor: {
        execute: async (ctx) => {
          started.push(ctx.step.id);
          if (ctx.step.id === 's1') {
            await first.promise;
          }
          return ok(ctx);
        },
      },
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
      sleep: async () => {},
    });
    const handle = engine.start({ runId: 'r1', workflowId: 'wf-1', userId: 'u1' });
    await waitFor(() => started.includes('s1'));
    handle.controller.pause();
    first.resolve();
    await waitFor(() => runs.transitions.some((t) => t.to === 'paused'));
    expect(started).toEqual(['s1']);
    handle.controller.resume();
    const result = await handle.completion;
    expect(result.state).toBe('completed');
    expect(started).toEqual(['s1', 's2']);
    const tos = runs.transitions.map((t) => t.to);
    expect(tos).toContain('paused');
    expect(tos).toContain('running');
    expect(tos).toContain('completed');
  });

  it('cancels mid run', async () => {
    const definition = {
      steps: [
        { id: 's1', type: 'delay', delayMs: 1000 },
        { id: 's2', type: 'transform' },
      ],
    };
    const runs = makeRunStore();
    const workflows = makeWorkflowStore(definition);
    const engine = createWorkflowEngine({
      workflows,
      runs,
      executor: { execute: ok },
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
      sleep: async (ms, signal) => {
        const p = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, ms);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new Error('aborted'));
            },
            { once: true },
          );
        });
        await p;
      },
    });
    const handle = engine.start({ runId: 'r1', workflowId: 'wf-1', userId: 'u1' });
    setTimeout(() => handle.controller.cancel(), 0);
    const result = await handle.completion;
    expect(result.state).toBe('cancelled');
  });

  it('tracks state transitions sequence', async () => {
    const definition = {
      steps: [{ id: 's1', type: 'transform' }],
    };
    const runs = makeRunStore();
    const workflows = makeWorkflowStore(definition);
    const engine = createWorkflowEngine({
      workflows,
      runs,
      executor: { execute: ok },
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const result = await engine.run({ runId: 'r1', workflowId: 'wf-1', userId: 'u1' });
    expect(result.state).toBe('completed');
    expect(runs.transitions.map((t) => t.to)).toEqual(['running', 'completed']);
  });
});
