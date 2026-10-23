import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createUsageRecordMethods } from './usageRecord';
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
let methods: ReturnType<typeof createUsageRecordMethods>;

const user = new mongoose.Types.ObjectId().toString();
const org = new mongoose.Types.ObjectId().toString();

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  methods = createUsageRecordMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.models.UsageRecord.deleteMany({});
});

describe('createUsageRecord', () => {
  it('records a measurement', async () => {
    const record = await runAs(TENANT_A, () =>
      methods.createUsageRecord({ scope: 'user', userId: user, key: 'tokens', value: 500 }),
    );

    expect(record).toMatchObject({ scope: 'user', key: 'tokens', value: 500 });
    expect(record.recordedAt).toBeInstanceOf(Date);
  });

  it('rejects an invalid attributed id', async () => {
    await expect(
      runAs(TENANT_A, () =>
        methods.createUsageRecord({ scope: 'user', userId: 'bad', key: 'x', value: 1 }),
      ),
    ).rejects.toThrow('A valid userId is required');
    await expect(
      runAs(TENANT_A, () =>
        methods.createUsageRecord({
          scope: 'organization',
          organizationId: 'bad',
          key: 'x',
          value: 1,
        }),
      ),
    ).rejects.toThrow('A valid organizationId is required');
    await expect(
      runAs(TENANT_A, () =>
        methods.createUsageRecord({ scope: 'workspace', workspaceId: 'bad', key: 'x', value: 1 }),
      ),
    ).rejects.toThrow('A valid workspaceId is required');
  });

  it('stores an explicit tenantId when no tenant context is active', async () => {
    const record = await methods.createUsageRecord({
      scope: 'user',
      userId: user,
      key: 'tokens',
      value: 1,
      tenantId: TENANT_A,
    });

    expect(record.tenantId).toBe(TENANT_A);
    await expect(methods.listUsageRecords({ tenantId: TENANT_A })).resolves.toHaveLength(1);
  });

  it('stamps the active tenant when the input carries none', async () => {
    const record = await runAs(TENANT_A, () =>
      methods.createUsageRecord({ scope: 'user', userId: user, key: 'tokens', value: 1 }),
    );

    expect(record.tenantId).toBe(TENANT_A);
  });
});

describe('getUsageRecord', () => {
  it('returns the record', async () => {
    const created = await runAs(TENANT_A, () =>
      methods.createUsageRecord({ scope: 'user', userId: user, key: 'tokens', value: 1 }),
    );

    const found = await runAs(TENANT_A, () => methods.getUsageRecord(created._id!.toString()));
    expect(found).toMatchObject({ key: 'tokens', value: 1 });
  });

  it('returns null for a malformed id', async () => {
    await expect(methods.getUsageRecord('nope')).resolves.toBeNull();
  });

  it("does not return another tenant's record", async () => {
    const created = await runAs(TENANT_A, () =>
      methods.createUsageRecord({ scope: 'user', userId: user, key: 'tokens', value: 1 }),
    );

    await expect(
      runAs(TENANT_B, () => methods.getUsageRecord(created._id!.toString())),
    ).resolves.toBeNull();
  });
});

describe('listUsageRecords', () => {
  it('filters by key and time window', async () => {
    await runAs(TENANT_A, async () => {
      await methods.createUsageRecord({
        scope: 'user',
        userId: user,
        key: 'tokens',
        value: 1,
        recordedAt: new Date('2025-01-01'),
      });
      await methods.createUsageRecord({
        scope: 'organization',
        organizationId: org,
        key: 'api_calls',
        value: 2,
        recordedAt: new Date('2025-06-01'),
      });
    });

    const tokens = await runAs(TENANT_A, () => methods.listUsageRecords({ key: 'tokens' }));
    expect(tokens).toHaveLength(1);

    const windowed = await runAs(TENANT_A, () =>
      methods.listUsageRecords({ from: new Date('2025-03-01'), to: new Date('2025-12-31') }),
    );
    expect(windowed).toHaveLength(1);
    expect(windowed[0].key).toBe('api_calls');
  });

  it('scopes listings to the active tenant', async () => {
    await runAs(TENANT_A, () =>
      methods.createUsageRecord({ scope: 'user', userId: user, key: 'tokens', value: 1 }),
    );
    await expect(runAs(TENANT_B, () => methods.listUsageRecords())).resolves.toHaveLength(0);
  });

  it('returns no results for a malformed attributed id', async () => {
    await expect(methods.listUsageRecords({ userId: 'not-an-id' })).resolves.toEqual([]);
    await expect(methods.listUsageRecords({ organizationId: 'not-an-id' })).resolves.toEqual([]);
    await expect(methods.listUsageRecords({ workspaceId: 'not-an-id' })).resolves.toEqual([]);
  });

  it('filters by an explicit tenantId when no tenant context is active', async () => {
    await runAs(TENANT_A, () =>
      methods.createUsageRecord({ scope: 'user', userId: user, key: 'tokens', value: 1 }),
    );
    await runAs(TENANT_B, () =>
      methods.createUsageRecord({ scope: 'user', userId: user, key: 'tokens', value: 1 }),
    );

    const scoped = await methods.listUsageRecords({ tenantId: TENANT_A });
    expect(scoped).toHaveLength(1);
    expect(scoped[0].tenantId).toBe(TENANT_A);
  });

  it('keeps the active tenant context authoritative over an explicit tenantId', async () => {
    await runAs(TENANT_A, () =>
      methods.createUsageRecord({ scope: 'user', userId: user, key: 'tokens', value: 1 }),
    );
    await runAs(TENANT_B, () =>
      methods.createUsageRecord({ scope: 'user', userId: user, key: 'tokens', value: 1 }),
    );

    const listed = await runAs(TENANT_A, () => methods.listUsageRecords({ tenantId: TENANT_B }));
    expect(listed).toHaveLength(1);
    expect(listed[0].tenantId).toBe(TENANT_A);
  });
});

describe('updateUsageRecord', () => {
  it('updates the value', async () => {
    const record = await runAs(TENANT_A, () =>
      methods.createUsageRecord({ scope: 'user', userId: user, key: 'requests', value: 5 }),
    );
    const updated = await runAs(TENANT_A, () =>
      methods.updateUsageRecord(record._id!.toString(), { value: 10 }),
    );

    expect(updated!.value).toBe(10);
  });

  it('returns null for a malformed id', async () => {
    await expect(
      runAs(TENANT_A, () => methods.updateUsageRecord('bad', { value: 1 })),
    ).resolves.toBeNull();
  });

  it("does not patch another tenant's record", async () => {
    const record = await runAs(TENANT_A, () =>
      methods.createUsageRecord({ scope: 'user', userId: user, key: 'requests', value: 5 }),
    );

    await expect(
      runAs(TENANT_B, () => methods.updateUsageRecord(record._id!.toString(), { value: 99 })),
    ).resolves.toBeNull();
  });
});

describe('deleteUsageRecord', () => {
  it('removes the record', async () => {
    const record = await runAs(TENANT_A, () =>
      methods.createUsageRecord({ scope: 'user', userId: user, key: 'x', value: 1 }),
    );
    await expect(
      runAs(TENANT_A, () => methods.deleteUsageRecord(record._id!.toString())),
    ).resolves.toBe(true);
    await expect(runAs(TENANT_A, () => methods.deleteUsageRecord('bad'))).resolves.toBe(false);
  });
});
