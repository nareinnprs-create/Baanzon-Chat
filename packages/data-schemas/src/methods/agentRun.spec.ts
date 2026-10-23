import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IAgentRun } from '..';
import { createAgentRunMethods, AGENT_RUN_LIST_MAX_LIMIT } from './agentRun';
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
let AgentRun: mongoose.Model<IAgentRun>;
let methods: ReturnType<typeof createAgentRunMethods>;

const user = new mongoose.Types.ObjectId().toString();
const otherUser = new mongoose.Types.ObjectId().toString();

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  AgentRun = mongoose.models.AgentRun as mongoose.Model<IAgentRun>;
  methods = createAgentRunMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await AgentRun.deleteMany({});
});

describe('startAgentRun', () => {
  it('creates a pending run with a start time', async () => {
    const run = await methods.startAgentRun({
      runId: 'run-1',
      agentId: 'agent-1',
      user,
      conversationId: 'conv-1',
      messageId: 'msg-1',
      metadata: { trigger: 'manual' },
    });

    expect(run).toMatchObject({
      runId: 'run-1',
      agentId: 'agent-1',
      status: 'pending',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      metadata: { trigger: 'manual' },
    });
    expect(run.startedAt).toBeInstanceOf(Date);
  });

  it('is idempotent per run id and does not clobber an existing run', async () => {
    const first = await methods.startAgentRun({ runId: 'run-1', agentId: 'agent-1', user });
    await methods.markAgentRunRunning(user, 'run-1');

    const second = await methods.startAgentRun({ runId: 'run-1', agentId: 'agent-1', user });
    expect(second._id!.toString()).toBe(first._id!.toString());
    expect(second.status).toBe('running');
    expect(await AgentRun.countDocuments({ runId: 'run-1' })).toBe(1);
  });
});

describe('markAgentRunRunning', () => {
  it('moves a pending run to running', async () => {
    await methods.startAgentRun({ runId: 'run-1', agentId: 'agent-1', user });
    const running = await methods.markAgentRunRunning(user, 'run-1');
    expect(running?.status).toBe('running');
  });

  it('returns null for an unknown run', async () => {
    expect(await methods.markAgentRunRunning(user, 'missing')).toBeNull();
  });
});

describe('completeAgentRun', () => {
  it('settles a run with token totals and a finish time', async () => {
    await methods.startAgentRun({ runId: 'run-1', agentId: 'agent-1', user });
    const settled = await methods.completeAgentRun(user, 'run-1', {
      status: 'succeeded',
      inputTokens: 10,
      outputTokens: 20,
    });

    expect(settled).toMatchObject({
      status: 'succeeded',
      inputTokens: 10,
      outputTokens: 20,
    });
    expect(settled?.finishedAt).toBeInstanceOf(Date);
  });

  it('records a failure reason', async () => {
    await methods.startAgentRun({ runId: 'run-1', agentId: 'agent-1', user });
    const failed = await methods.completeAgentRun(user, 'run-1', {
      status: 'failed',
      error: 'boom',
    });

    expect(failed).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('returns null when the run is unknown or owned by someone else', async () => {
    await methods.startAgentRun({ runId: 'run-1', agentId: 'agent-1', user });
    expect(await methods.completeAgentRun(otherUser, 'run-1', { status: 'failed' })).toBeNull();
    expect(await methods.completeAgentRun(user, 'missing', { status: 'failed' })).toBeNull();
  });
});

describe('getAgentRun', () => {
  it('returns a run only for its owner', async () => {
    await methods.startAgentRun({ runId: 'run-1', agentId: 'agent-1', user });
    expect((await methods.getAgentRun(user, 'run-1'))?.runId).toBe('run-1');
    expect(await methods.getAgentRun(otherUser, 'run-1')).toBeNull();
    expect(await methods.getAgentRun(user, 'missing')).toBeNull();
  });
});

describe('listAgentRuns', () => {
  it("lists a user's runs, filtered by status and capped by limit", async () => {
    await methods.startAgentRun({ runId: 'run-1', agentId: 'agent-a', user });
    await methods.startAgentRun({ runId: 'run-2', agentId: 'agent-a', user });
    await methods.completeAgentRun(user, 'run-2', { status: 'succeeded' });
    await methods.startAgentRun({ runId: 'run-3', agentId: 'agent-b', user: otherUser });

    const all = await methods.listAgentRunsForUser(user);
    expect(all).toHaveLength(2);

    const succeeded = await methods.listAgentRunsForUser(user, { status: 'succeeded' });
    expect(succeeded.map((run) => run.runId)).toEqual(['run-2']);

    const capped = await methods.listAgentRunsForUser(user, { limit: 1 });
    expect(capped).toHaveLength(1);
  });

  it('lists runs for an agent across users', async () => {
    await methods.startAgentRun({ runId: 'run-1', agentId: 'agent-a', user });
    await methods.startAgentRun({ runId: 'run-2', agentId: 'agent-a', user: otherUser });
    await methods.startAgentRun({ runId: 'run-3', agentId: 'agent-b', user });

    expect(await methods.listAgentRunsForAgent('agent-a')).toHaveLength(2);
    expect(await methods.listAgentRunsForAgent('agent-b')).toHaveLength(1);
  });

  it('caps an oversized limit request', async () => {
    await methods.startAgentRun({ runId: 'run-1', agentId: 'agent-a', user });
    const runs = await methods.listAgentRunsForUser(user, {
      limit: AGENT_RUN_LIST_MAX_LIMIT + 100,
    });
    expect(runs).toHaveLength(1);
  });
});

describe('tenant isolation', () => {
  it('keeps runs invisible across tenants', async () => {
    await runAs(TENANT_A, () =>
      methods.startAgentRun({ runId: 'run-1', agentId: 'agent-a', user }),
    );

    expect(await runAs(TENANT_B, () => methods.listAgentRunsForUser(user))).toEqual([]);
    expect(await runAs(TENANT_B, () => methods.getAgentRun(user, 'run-1'))).toBeNull();
  });
});
