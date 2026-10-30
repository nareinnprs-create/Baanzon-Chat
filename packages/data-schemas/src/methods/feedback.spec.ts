import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { tenantStorage } from '../config/tenantContext';
import { createFeedbackMethods } from './feedback';
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
let methods: ReturnType<typeof createFeedbackMethods>;

const user = new mongoose.Types.ObjectId().toString();
const processor = new mongoose.Types.ObjectId().toString();

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  methods = createFeedbackMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.models.Feedback.deleteMany({});
});

describe('createFeedback', () => {
  it('defaults to open status and records submission time', async () => {
    const feedback = await runAs(TENANT_A, () =>
      methods.createFeedback({
        userId: user,
        type: 'feature',
        subject: 'New',
        message: 'Please add X',
      }),
    );

    expect(feedback).toMatchObject({ type: 'feature', subject: 'New', status: 'open' });
    expect(feedback.submittedAt).toBeInstanceOf(Date);
  });

  it('supports anonymous submission', async () => {
    const feedback = await runAs(TENANT_A, () =>
      methods.createFeedback({
        email: 'anon@example.com',
        type: 'general',
        subject: 'Hi',
        message: 'Hello',
      }),
    );

    expect(feedback.userId).toBeUndefined();
    expect(feedback.email).toBe('anon@example.com');
  });

  it('rejects an invalid user id', async () => {
    await expect(
      runAs(TENANT_A, () =>
        methods.createFeedback({ userId: 'bad', type: 'bug', subject: 's', message: 'm' }),
      ),
    ).rejects.toThrow('A valid userId is required');
  });

  it('stores an explicit tenantId when no tenant context is active', async () => {
    const feedback = await methods.createFeedback({
      userId: user,
      type: 'bug',
      subject: 'S',
      message: 'm',
      tenantId: TENANT_A,
    });

    expect(feedback.tenantId).toBe(TENANT_A);
    await expect(methods.listFeedback({ tenantId: TENANT_A })).resolves.toHaveLength(1);
  });

  it('stamps the active tenant when the input carries none', async () => {
    const feedback = await runAs(TENANT_A, () =>
      methods.createFeedback({ userId: user, type: 'bug', subject: 'S', message: 'm' }),
    );

    expect(feedback.tenantId).toBe(TENANT_A);
  });
});

describe('getFeedback', () => {
  it('returns the feedback', async () => {
    const created = await runAs(TENANT_A, () =>
      methods.createFeedback({ userId: user, type: 'bug', subject: 'Bug', message: 'm' }),
    );

    const found = await runAs(TENANT_A, () => methods.getFeedback(created._id!.toString()));
    expect(found).toMatchObject({ subject: 'Bug' });
  });

  it('returns null for a malformed id', async () => {
    await expect(methods.getFeedback('nope')).resolves.toBeNull();
  });

  it("does not return another tenant's feedback", async () => {
    const created = await runAs(TENANT_A, () =>
      methods.createFeedback({ userId: user, type: 'bug', subject: 'Bug', message: 'm' }),
    );

    await expect(
      runAs(TENANT_B, () => methods.getFeedback(created._id!.toString())),
    ).resolves.toBeNull();
  });
});

describe('listFeedback', () => {
  it('filters by type and status', async () => {
    await runAs(TENANT_A, async () => {
      await methods.createFeedback({ userId: user, type: 'bug', subject: 'Bug', message: 'm' });
      await methods.createFeedback({
        userId: user,
        type: 'general',
        subject: 'Other',
        message: 'm',
      });
    });

    const bugs = await runAs(TENANT_A, () => methods.listFeedback({ type: 'bug' }));
    expect(bugs).toHaveLength(1);
    expect(bugs[0].subject).toBe('Bug');
  });

  it('scopes listings to the active tenant', async () => {
    await runAs(TENANT_A, () =>
      methods.createFeedback({ userId: user, type: 'bug', subject: 'Bug', message: 'm' }),
    );
    await expect(runAs(TENANT_B, () => methods.listFeedback())).resolves.toHaveLength(0);
  });

  it('returns no results for a malformed user id', async () => {
    await expect(methods.listFeedback({ userId: 'not-an-id' })).resolves.toEqual([]);
  });

  it('filters by an explicit tenantId when no tenant context is active', async () => {
    await runAs(TENANT_A, () =>
      methods.createFeedback({ userId: user, type: 'bug', subject: 'A', message: 'm' }),
    );
    await runAs(TENANT_B, () =>
      methods.createFeedback({ userId: user, type: 'bug', subject: 'B', message: 'm' }),
    );

    const scoped = await methods.listFeedback({ tenantId: TENANT_A });
    expect(scoped).toHaveLength(1);
    expect(scoped[0].tenantId).toBe(TENANT_A);
  });

  it('keeps the active tenant context authoritative over an explicit tenantId', async () => {
    await runAs(TENANT_A, () =>
      methods.createFeedback({ userId: user, type: 'bug', subject: 'A', message: 'm' }),
    );
    await runAs(TENANT_B, () =>
      methods.createFeedback({ userId: user, type: 'bug', subject: 'B', message: 'm' }),
    );

    const listed = await runAs(TENANT_A, () => methods.listFeedback({ tenantId: TENANT_B }));
    expect(listed).toHaveLength(1);
    expect(listed[0].tenantId).toBe(TENANT_A);
  });
});

describe('updateFeedback', () => {
  it('advances triage status and records the processor', async () => {
    const feedback = await runAs(TENANT_A, () =>
      methods.createFeedback({ userId: user, type: 'bug', subject: 'Bug', message: 'm' }),
    );
    const updated = await runAs(TENANT_A, () =>
      methods.updateFeedback(feedback._id!.toString(), {
        status: 'resolved',
        processedBy: processor,
      }),
    );

    expect(updated).toMatchObject({ status: 'resolved' });
    expect(updated!.processedBy!.toString()).toBe(processor);
  });

  it('rejects an invalid processor id', async () => {
    const feedback = await runAs(TENANT_A, () =>
      methods.createFeedback({ userId: user, type: 'bug', subject: 'Bug', message: 'm' }),
    );
    await expect(
      runAs(TENANT_A, () =>
        methods.updateFeedback(feedback._id!.toString(), { processedBy: 'bad' }),
      ),
    ).rejects.toThrow('A valid processedBy is required');
  });
});

describe('deleteFeedback', () => {
  it('removes the feedback', async () => {
    const feedback = await runAs(TENANT_A, () =>
      methods.createFeedback({ userId: user, type: 'bug', subject: 'Bug', message: 'm' }),
    );
    await expect(
      runAs(TENANT_A, () => methods.deleteFeedback(feedback._id!.toString())),
    ).resolves.toBe(true);
    await expect(runAs(TENANT_A, () => methods.deleteFeedback('bad'))).resolves.toBe(false);
  });
});
