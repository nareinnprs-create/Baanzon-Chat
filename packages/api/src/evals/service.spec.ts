import type { CreateEvalRunInput, IEvalRun } from '@librechat/data-schemas';
import type { EvalRunStore } from './types';
import { createEvalService, createNoTransportEvalInvokers } from './service';

let counter = 0;

function makeRun(input: CreateEvalRunInput): IEvalRun {
  counter += 1;
  return {
    _id: `run-${counter}` as never,
    agentId: input.agentId ?? null,
    workflowId: input.workflowId ?? null,
    datasetName: input.datasetName,
    status: 'queued',
    dataset: input.dataset ?? null,
    scores: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

/** In-memory store mirroring the data-schemas method contract. */
function memoryStore(overrides: Partial<EvalRunStore> = {}): jest.Mocked<EvalRunStore> {
  const runs = new Map<string, IEvalRun>();
  const store = {
    createEvalRun: jest.fn(async (input: CreateEvalRunInput) => {
      const run = makeRun(input);
      runs.set(String(run._id), run);
      return run;
    }),
    updateEvalRunResult: jest.fn(
      async (input: {
        runId: string;
        status: IEvalRun['status'];
        scores?: never[];
        error?: string;
      }) => {
        const run = runs.get(input.runId);
        if (!run) {
          return null;
        }
        run.status = input.status;
        run.scores = (input.scores as IEvalRun['scores']) ?? run.scores;
        run.error = input.error ?? run.error;
        if (input.status === 'running') {
          run.startedAt = new Date();
        } else {
          run.finishedAt = new Date();
        }
        return run;
      },
    ),
    getEvalRunById: jest.fn(async (id: string) => runs.get(id) ?? null),
    listEvalRuns: jest.fn(async () => Array.from(runs.values()).reverse()),
    ...overrides,
  };
  return store as unknown as jest.Mocked<EvalRunStore>;
}

const dataset = {
  cases: [
    {
      name: 'greeting',
      input: 'hi',
      expected: 'Hello',
      assertions: [{ type: 'exact' as const, value: 'Hello' }],
    },
  ],
};

function echoInvokers() {
  return {
    invokeAgent: jest
      .fn()
      .mockImplementation(async ({ input }: { agentId: string; input: string }) => ({
        output: input === 'hi' ? 'Hello' : 'Goodbye',
      })),
    invokeWorkflow: jest
      .fn()
      .mockImplementation(async ({ input }: { workflowId: string; input: string }) => ({
        output: input === 'hi' ? 'Hello' : 'Goodbye',
      })),
  };
}

describe('createEvalService', () => {
  it('drives an agent run queued -> running -> passed with scores stored', async () => {
    const store = memoryStore();
    const service = createEvalService({ store, invokers: echoInvokers() });

    const run = await service.startRun({ agentId: 'a1', datasetName: 'set', dataset });

    expect(run.status).toBe('passed');
    expect(run.startedAt).not.toBeNull();
    expect(run.finishedAt).not.toBeNull();
    expect(run.scores).toEqual([{ name: 'greeting', passed: true, failures: [] }]);
    expect(store.updateEvalRunResult).toHaveBeenCalledTimes(2);
  });

  it('scores a partial dataset as failed and keeps the failing scores', async () => {
    const store = memoryStore();
    const service = createEvalService({ store, invokers: echoInvokers() });

    const run = await service.startRun({
      agentId: 'a1',
      datasetName: 'set',
      dataset: {
        cases: [
          ...dataset.cases,
          {
            name: 'bye',
            input: 'bye',
            expected: 'x',
            assertions: [{ type: 'contains' as const, value: 'never' }],
          },
        ],
      },
    });

    expect(run.status).toBe('failed');
    expect(run.scores).toHaveLength(2);
    expect(run.scores?.[1].failures).toHaveLength(1);
  });

  it('routes workflow runs through the workflow invoker', async () => {
    const store = memoryStore();
    const invokers = echoInvokers();
    const service = createEvalService({ store, invokers });

    const run = await service.startRun({ workflowId: 'w1', datasetName: 'set', dataset });

    expect(run.status).toBe('passed');
    expect(invokers.invokeWorkflow).toHaveBeenCalledWith({
      workflowId: 'w1',
      input: 'hi',
    });
    expect(invokers.invokeAgent).not.toHaveBeenCalled();
  });

  it('fails the run with a no-transport error when no invoker is wired', async () => {
    const store = memoryStore();
    const service = createEvalService({ store });

    const run = await service.startRun({ agentId: 'a1', datasetName: 'set', dataset });

    expect(run.status).toBe('failed');
    expect(run.error).toBe('no transport: no agent invoker is wired for evals');
    expect(run.scores).toBeNull();
  });

  it('names the workflow kind in the no-transport error', async () => {
    const store = memoryStore();
    const service = createEvalService({ store });

    const run = await service.startRun({ workflowId: 'w1', datasetName: 'set', dataset });

    expect(run.error).toBe('no transport: no workflow invoker is wired for evals');
  });

  it('fails an empty dataset before touching a transport', async () => {
    const store = memoryStore();
    const invokers = echoInvokers();
    const service = createEvalService({ store, invokers });

    const run = await service.startRun({
      agentId: 'a1',
      datasetName: 'empty',
      dataset: { cases: [] },
    });

    expect(run.status).toBe('failed');
    expect(run.error).toContain('Empty dataset');
    expect(invokers.invokeAgent).not.toHaveBeenCalled();
  });

  it('records an invoker throw as a failed case, not a crashed run', async () => {
    const store = memoryStore();
    const service = createEvalService({
      store,
      invokers: {
        invokeAgent: jest.fn().mockRejectedValue(new Error('transport down')),
        invokeWorkflow: jest.fn(),
      },
    });

    const run = await service.startRun({ agentId: 'a1', datasetName: 'set', dataset });

    expect(run.status).toBe('failed');
    expect(run.scores?.[0].failures).toEqual(['transport down']);
  });
});

describe('createNoTransportEvalInvokers', () => {
  it('throws a no-transport error for both invocation kinds', async () => {
    const invokers = createNoTransportEvalInvokers();
    await expect(invokers.invokeAgent({ agentId: 'a', input: 'x' })).rejects.toThrow(
      'no transport',
    );
    await expect(invokers.invokeWorkflow({ workflowId: 'w', input: 'x' })).rejects.toThrow(
      'no transport',
    );
  });
});
