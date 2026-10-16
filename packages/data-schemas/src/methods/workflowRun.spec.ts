import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IWorkflowRun } from '..';
import { createWorkflowRunMethods, WORKFLOW_RUN_LIST_MAX_LIMIT } from './workflowRun';
import { tenantStorage } from '../config/tenantContext';
import { createModels } from '../models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const TENANT_A = 'tenant-aaaaaaaaaaaaaaaaaaaa';
const TENANT_B = 'tenant-bbbbbbbbbbbbbbbbbbbb';

let mongoServer: MongoMemoryServer;
let WorkflowRun: mongoose.Model<IWorkflowRun>;
let methods: ReturnType<typeof createWorkflowRunMethods>;

const user = new mongoose.Types.ObjectId().toString();
const otherUser = new mongoose.Types.ObjectId().toString();
const workflowId = new mongoose.Types.ObjectId().toString();
const otherWorkflowId = new mongoose.Types.ObjectId().toString();

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  WorkflowRun = mongoose.models.WorkflowRun as mongoose.Model<IWorkflowRun>;
  methods = createWorkflowRunMethods(mongoose);
  await WorkflowRun.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await WorkflowRun.deleteMany({});
});

describe('startWorkflowRun', () => {
  it('creates a pending run with a start time', async () => {
    const run = await methods.startWorkflowRun({
      runId: 'run-1',
      workflowId,
      user,
      metadata: { trigger: 'manual' },
    });

    expect(run).toMatchObject({
      runId: 'run-1',
      status: 'pending',
      metadata: { trigger: 'manual' },
    });
    expect(run.startedAt).toBeInstanceOf(Date);
    expect(run.workflowId.toString()).toBe(workflowId);
  });

  it('is idempotent per run id and does not clobber an existing run', async () => {
    const first = await methods.startWorkflowRun({ runId: 'run-1', workflowId, user });
    await methods.markWorkflowRunRunning(user, 'run-1');

    const second = await methods.startWorkflowRun({ runId: 'run-1', workflowId, user });
    expect(second._id!.toString()).toBe(first._id!.toString());
    expect(second.status).toBe('running');
    expect(await WorkflowRun.countDocuments({ runId: 'run-1' })).toBe(1);
  });

  it('rejects invalid ids', async () => {
    await expect(
      methods.startWorkflowRun({ runId: 'run-1', workflowId: 'bad', user }),
    ).rejects.toThrow(/workflowId is required/i);
    await expect(
      methods.startWorkflowRun({ runId: 'run-1', workflowId, user: 'bad' }),
    ).rejects.toThrow(/user is required/i);
  });
});

describe('getWorkflowRun / markWorkflowRunRunning / completeWorkflowRun', () => {
  it('runs a workflow through its lifecycle for its owner', async () => {
    await methods.startWorkflowRun({ runId: 'run-1', workflowId, user });

    expect((await methods.markWorkflowRunRunning(user, 'run-1'))?.status).toBe('running');
    expect(await methods.markWorkflowRunRunning(user, 'missing')).toBeNull();

    const settled = await methods.completeWorkflowRun(user, 'run-1', { status: 'succeeded' });
    expect(settled?.status).toBe('succeeded');
    expect(settled?.finishedAt).toBeInstanceOf(Date);

    expect((await methods.getWorkflowRun(user, 'run-1'))?.runId).toBe('run-1');
    expect(await methods.getWorkflowRun(otherUser, 'run-1')).toBeNull();
  });

  it('records a failure reason and scopes settlement to the owner', async () => {
    await methods.startWorkflowRun({ runId: 'run-1', workflowId, user });
    const failed = await methods.completeWorkflowRun(user, 'run-1', {
      status: 'failed',
      error: 'boom',
    });
    expect(failed).toMatchObject({ status: 'failed', error: 'boom' });

    expect(
      await methods.completeWorkflowRun(otherUser, 'run-1', { status: 'failed' }),
    ).toBeNull();
    expect(await methods.completeWorkflowRun(user, 'missing', { status: 'failed' })).toBeNull();
  });
});

describe('listWorkflowRunsForUser / listWorkflowRunsForWorkflow', () => {
  it('filters by status and caps the page', async () => {
    await methods.startWorkflowRun({ runId: 'run-1', workflowId, user });
    await methods.startWorkflowRun({ runId: 'run-2', workflowId, user });
    await methods.completeWorkflowRun(user, 'run-2', { status: 'succeeded' });
    await methods.startWorkflowRun({ runId: 'run-3', workflowId, user: otherUser });

    expect(await methods.listWorkflowRunsForUser(user)).toHaveLength(2);
    expect(
      (await methods.listWorkflowRunsForUser(user, { status: 'succeeded' })).map((r) => r.runId),
    ).toEqual(['run-2']);
    expect(await methods.listWorkflowRunsForUser(user, { limit: 1 })).toHaveLength(1);
    expect(
      await methods.listWorkflowRunsForUser(user, { limit: WORKFLOW_RUN_LIST_MAX_LIMIT + 50 }),
    ).toHaveLength(2);
    expect(await methods.listWorkflowRunsForUser('bad')).toEqual([]);
  });

  it('lists runs for a workflow across users', async () => {
    await methods.startWorkflowRun({ runId: 'run-1', workflowId, user });
    await methods.startWorkflowRun({ runId: 'run-2', workflowId, user: otherUser });
    await methods.startWorkflowRun({ runId: 'run-3', workflowId: otherWorkflowId, user });

    expect(await methods.listWorkflowRunsForWorkflow(workflowId)).toHaveLength(2);
    expect(await methods.listWorkflowRunsForWorkflow(otherWorkflowId)).toHaveLength(1);
    expect(await methods.listWorkflowRunsForWorkflow('bad')).toEqual([]);
  });
});

describe('tenant isolation', () => {
  it('keeps runs invisible across tenants', async () => {
    await runAs(TENANT_A, () =>
      methods.startWorkflowRun({ runId: 'run-1', workflowId, user }),
    );

    expect(await runAs(TENANT_B, () => methods.listWorkflowRunsForUser(user))).toEqual([]);
    expect(await runAs(TENANT_B, () => methods.getWorkflowRun(user, 'run-1'))).toBeNull();
  });
});
