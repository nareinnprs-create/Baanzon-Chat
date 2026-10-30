import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IEvalRun } from '~/types/evalRun';
import { createEvalRunMethods, EVAL_RUN_LIST_MAX_LIMIT, type EvalRunMethods } from './evalRun';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let EvalRun: mongoose.Model<IEvalRun>;
let methods: EvalRunMethods;
let modelsToCleanup: string[] = [];

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  const models = createModels(mongoose);
  modelsToCleanup = Object.keys(models);
  Object.assign(mongoose.models, models);

  EvalRun = mongoose.models.EvalRun as mongoose.Model<IEvalRun>;
  methods = createEvalRunMethods(mongoose);

  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();

  for (const modelName of modelsToCleanup) {
    if (mongoose.models[modelName]) {
      delete mongoose.models[modelName];
    }
  }
});

afterEach(async () => {
  await EvalRun.deleteMany({});
});

describe('EvalRun methods', () => {
  const agentId = '64b64b64b64b64b64b64b640';
  const otherAgentId = '64b64b64b64b64b64b64b641';
  const workflowId = '64b64b64b64b64b64b64b650';

  it('creates a queued run with the dataset stored as JSON', async () => {
    const dataset = {
      name: 'greeting',
      cases: [
        {
          name: 'hi',
          input: 'hi',
          expected: 'Hello',
          assertions: [{ type: 'contains' as const, value: 'Hello' }],
        },
      ],
    };
    const created = await methods.createEvalRun({
      agentId,
      datasetName: 'greeting-set',
      dataset,
    });
    expect(created.status).toBe('queued');
    expect(String(created.agentId)).toBe(agentId);
    expect(created.workflowId ?? null).toBeNull();
    expect(created.datasetName).toBe('greeting-set');
    expect(created.dataset?.cases).toHaveLength(1);
    expect(created.scores ?? null).toBeNull();
    expect(created.finishedAt ?? null).toBeNull();
  });

  it('rejects runs without exactly one target and with an empty datasetName', async () => {
    await expect(
      methods.createEvalRun({ datasetName: 'both', agentId, workflowId }),
    ).rejects.toThrow('exactly one target');
    await expect(methods.createEvalRun({ datasetName: 'none' })).rejects.toThrow(
      'exactly one target',
    );
    await expect(
      methods.createEvalRun({ agentId: 'not-an-id', datasetName: 'bad-id' }),
    ).rejects.toThrow('valid id');
    await expect(
      methods.createEvalRun({ workflowId: 'not-an-id', datasetName: 'bad-id' }),
    ).rejects.toThrow('valid id');
    await expect(methods.createEvalRun({ agentId, datasetName: '   ' })).rejects.toThrow(
      'non-empty datasetName',
    );
  });

  it('moves a run through running -> passed and stamps started/finished times', async () => {
    const created = await methods.createEvalRun({ agentId, datasetName: 'set' });
    const runId = String(created._id);

    const running = await methods.updateEvalRunResult({ runId, status: 'running' });
    expect(running?.status).toBe('running');
    expect(running?.startedAt).toBeInstanceOf(Date);

    const passed = await methods.updateEvalRunResult({
      runId,
      status: 'passed',
      scores: [{ name: 'hi', passed: true, failures: [] }],
    });
    expect(passed?.status).toBe('passed');
    expect(passed?.finishedAt).toBeInstanceOf(Date);
    expect(passed?.scores).toHaveLength(1);
  });

  it('rejects result updates that re-queue or carry a malformed id or scores', async () => {
    await expect(
      methods.updateEvalRunResult({ runId: agentId, status: 'queued' as never }),
    ).rejects.toThrow('non-queued status');
    await expect(methods.updateEvalRunResult({ runId: 'nope', status: 'failed' })).rejects.toThrow(
      'valid id',
    );
    await expect(
      methods.updateEvalRunResult({
        runId: agentId,
        status: 'failed',
        scores: 'not-an-array' as never,
      }),
    ).rejects.toThrow('scores must be an array');
  });

  it('lists runs per agent, newest first, capped at the max limit', async () => {
    for (let i = 0; i < 3; i++) {
      await methods.createEvalRun({ agentId, datasetName: `set-${i}` });
    }
    await methods.createEvalRun({ agentId: otherAgentId, datasetName: 'other' });
    await methods.createEvalRun({ workflowId, datasetName: 'flow' });

    const forAgent = await methods.listEvalRuns({ agentId });
    expect(forAgent).toHaveLength(3);
    expect(forAgent.every((run) => String(run.agentId) === agentId)).toBe(true);
    expect(new Date(forAgent[0].createdAt ?? 0) >= new Date(forAgent[2].createdAt ?? 0)).toBe(true);

    const forWorkflow = await methods.listEvalRuns({ workflowId });
    expect(forWorkflow).toHaveLength(1);
    expect(forWorkflow[0].datasetName).toBe('flow');

    const capped = await methods.listEvalRuns({ agentId, limit: EVAL_RUN_LIST_MAX_LIMIT + 50 });
    expect(capped).toHaveLength(3);

    const limited = await methods.listEvalRuns({ agentId, limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it('fetches one run by id and answers null for unknown or malformed ids', async () => {
    const created = await methods.createEvalRun({ workflowId, datasetName: 'set' });
    const found = await methods.getEvalRunById(String(created._id));
    expect(String(found?._id)).toBe(String(created._id));
    expect(await methods.getEvalRunById('not-an-id')).toBeNull();
    expect(await methods.getEvalRunById(otherAgentId)).toBeNull();
  });
});
