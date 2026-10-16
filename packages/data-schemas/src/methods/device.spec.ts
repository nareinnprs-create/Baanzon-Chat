import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { tenantStorage } from '../config/tenantContext';
import { createDeviceMethods } from './device';
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
let methods: ReturnType<typeof createDeviceMethods>;

const user = new mongoose.Types.ObjectId().toString();

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  methods = createDeviceMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.models.Device.deleteMany({});
});

describe('createDevice', () => {
  it('defaults to an active device', async () => {
    const device = await runAs(TENANT_A, () =>
      methods.createDevice({ userId: user, deviceName: 'MacBook Pro', platform: 'macos' }),
    );

    expect(device).toMatchObject({ deviceName: 'MacBook Pro', platform: 'macos', isActive: true });
    expect(device._id).toBeDefined();
  });

  it('rejects an invalid user id', async () => {
    await expect(
      runAs(TENANT_A, () => methods.createDevice({ userId: 'not-an-id' })),
    ).rejects.toThrow('A valid userId is required');
  });
});

describe('getDevice', () => {
  it('returns null for a malformed id', async () => {
    await expect(methods.getDevice('nope')).resolves.toBeNull();
  });
});

describe('listDevices', () => {
  it('filters by user and active status', async () => {
    await runAs(TENANT_A, async () => {
      await methods.createDevice({ userId: user, deviceName: 'A', isActive: true });
      await methods.createDevice({ userId: user, deviceName: 'B', isActive: false });
    });

    const active = await runAs(TENANT_A, () =>
      methods.listDevices({ userId: user, isActive: true }),
    );
    expect(active).toHaveLength(1);
    expect(active[0].deviceName).toBe('A');
  });

  it('scopes listings to the active tenant', async () => {
    await runAs(TENANT_A, () => methods.createDevice({ userId: user, deviceName: 'A' }));

    const otherTenant = await runAs(TENANT_B, () => methods.listDevices());
    expect(otherTenant).toHaveLength(0);
  });
});

describe('updateDevice', () => {
  it('applies a patch', async () => {
    const device = await runAs(TENANT_A, () => methods.createDevice({ userId: user }));
    const updated = await runAs(TENANT_A, () =>
      methods.updateDevice(device._id!.toString(), { deviceName: 'Renamed', isActive: false }),
    );

    expect(updated).toMatchObject({ deviceName: 'Renamed', isActive: false });
  });

  it('returns null for a malformed id', async () => {
    await expect(
      runAs(TENANT_A, () => methods.updateDevice('bad', { isActive: false })),
    ).resolves.toBeNull();
  });
});

describe('deleteDevice', () => {
  it('removes the device', async () => {
    const device = await runAs(TENANT_A, () => methods.createDevice({ userId: user }));
    const removed = await runAs(TENANT_A, () => methods.deleteDevice(device._id!.toString()));

    expect(removed).toBe(true);
    await expect(
      runAs(TENANT_A, () => methods.getDevice(device._id!.toString())),
    ).resolves.toBeNull();
  });

  it('returns false when the device is not in the tenant', async () => {
    const device = await runAs(TENANT_A, () => methods.createDevice({ userId: user }));
    await expect(runAs(TENANT_B, () => methods.deleteDevice(device._id!.toString()))).resolves.toBe(
      false,
    );
  });
});
