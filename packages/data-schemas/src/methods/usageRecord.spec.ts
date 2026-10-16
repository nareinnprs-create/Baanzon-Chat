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
