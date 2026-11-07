import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createSubscriptionMethods } from './subscription';
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
let methods: ReturnType<typeof createSubscriptionMethods>;

const user = new mongoose.Types.ObjectId().toString();

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  methods = createSubscriptionMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.models.Subscription.deleteMany({});
});

describe('createSubscription', () => {
  it('defaults to active status', async () => {
    const subscription = await runAs(TENANT_A, () =>
      methods.createSubscription({ userId: user, plan: 'pro' }),
    );

    expect(subscription).toMatchObject({ plan: 'pro', status: 'active' });
    expect(subscription._id).toBeDefined();
  });

  it('rejects an invalid user id', async () => {
    await expect(
      runAs(TENANT_A, () => methods.createSubscription({ userId: 'nope', plan: 'free' })),
    ).rejects.toThrow('A valid userId is required');
  });

  it('stores an explicit tenantId when no tenant context is active', async () => {
    const subscription = await methods.createSubscription({
      userId: user,
      plan: 'pro',
      tenantId: TENANT_A,
    });

    expect(subscription.tenantId).toBe(TENANT_A);
    await expect(methods.listSubscriptions({ tenantId: TENANT_A })).resolves.toHaveLength(1);
  });

  it('stamps the active tenant when the input carries none', async () => {
    const subscription = await runAs(TENANT_A, () =>
      methods.createSubscription({ userId: user, plan: 'free' }),
    );

    expect(subscription.tenantId).toBe(TENANT_A);
  });
});

describe('getSubscription', () => {
  it('returns the subscription', async () => {
    const created = await runAs(TENANT_A, () =>
      methods.createSubscription({ userId: user, plan: 'pro' }),
    );

    const found = await runAs(TENANT_A, () => methods.getSubscription(created._id!.toString()));
    expect(found).toMatchObject({ plan: 'pro' });
  });

  it('returns null for a malformed id', async () => {
    await expect(methods.getSubscription('nope')).resolves.toBeNull();
  });

  it("does not return another tenant's subscription", async () => {
    const created = await runAs(TENANT_A, () =>
      methods.createSubscription({ userId: user, plan: 'pro' }),
    );

    await expect(
      runAs(TENANT_B, () => methods.getSubscription(created._id!.toString())),
    ).resolves.toBeNull();
  });
});

describe('listSubscriptions', () => {
  it('filters by plan and status', async () => {
    await runAs(TENANT_A, async () => {
      await methods.createSubscription({ userId: user, plan: 'basic', status: 'active' });
      await methods.createSubscription({ userId: user, plan: 'pro', status: 'canceled' });
    });

    const pro = await runAs(TENANT_A, () =>
      methods.listSubscriptions({ userId: user, plan: 'pro' }),
    );
    expect(pro).toHaveLength(1);
    expect(pro[0].status).toBe('canceled');
  });

  it('scopes listings to the active tenant', async () => {
    await runAs(TENANT_A, () => methods.createSubscription({ userId: user, plan: 'pro' }));
    await expect(runAs(TENANT_B, () => methods.listSubscriptions())).resolves.toHaveLength(0);
  });

  it('returns no results for a malformed user id', async () => {
    await expect(methods.listSubscriptions({ userId: 'not-an-id' })).resolves.toEqual([]);
  });

  it('filters by an explicit tenantId when no tenant context is active', async () => {
    await runAs(TENANT_A, () => methods.createSubscription({ userId: user, plan: 'pro' }));
    await runAs(TENANT_B, () => methods.createSubscription({ userId: user, plan: 'basic' }));

    const scoped = await methods.listSubscriptions({ tenantId: TENANT_A });
    expect(scoped).toHaveLength(1);
    expect(scoped[0].tenantId).toBe(TENANT_A);
  });

  it('keeps the active tenant context authoritative over an explicit tenantId', async () => {
    await runAs(TENANT_A, () => methods.createSubscription({ userId: user, plan: 'pro' }));
    await runAs(TENANT_B, () => methods.createSubscription({ userId: user, plan: 'basic' }));

    const listed = await runAs(TENANT_A, () => methods.listSubscriptions({ tenantId: TENANT_B }));
    expect(listed).toHaveLength(1);
    expect(listed[0].tenantId).toBe(TENANT_A);
  });
});

describe('updateSubscription', () => {
  it('applies a billing-state change', async () => {
    const subscription = await runAs(TENANT_A, () =>
      methods.createSubscription({ userId: user, plan: 'free' }),
    );
    const updated = await runAs(TENANT_A, () =>
      methods.updateSubscription(subscription._id!.toString(), { plan: 'pro', status: 'active' }),
    );

    expect(updated).toMatchObject({ plan: 'pro', status: 'active' });
  });

  it('returns null for a malformed id', async () => {
    await expect(
      runAs(TENANT_A, () => methods.updateSubscription('bad', { plan: 'pro' })),
    ).resolves.toBeNull();
  });

  it("does not patch another tenant's subscription", async () => {
    const subscription = await runAs(TENANT_A, () =>
      methods.createSubscription({ userId: user, plan: 'free' }),
    );

    await expect(
      runAs(TENANT_B, () =>
        methods.updateSubscription(subscription._id!.toString(), { plan: 'pro' }),
      ),
    ).resolves.toBeNull();
  });
});

describe('deleteSubscription', () => {
  it('removes the subscription', async () => {
    const subscription = await runAs(TENANT_A, () =>
      methods.createSubscription({ userId: user, plan: 'free' }),
    );
    await expect(
      runAs(TENANT_A, () => methods.deleteSubscription(subscription._id!.toString())),
    ).resolves.toBe(true);
  });

  it('returns false for a malformed id', async () => {
    await expect(runAs(TENANT_A, () => methods.deleteSubscription('bad'))).resolves.toBe(false);
  });
});
