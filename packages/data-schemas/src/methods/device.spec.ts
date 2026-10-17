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

  it('stores an explicit tenantId when no tenant context is active', async () => {
    const device = await methods.createDevice({
      userId: user,
      deviceName: 'A',
      tenantId: TENANT_A,
    });

    expect(device.tenantId).toBe(TENANT_A);
    await expect(methods.listDevices({ tenantId: TENANT_A })).resolves.toHaveLength(1);
  });

  it('stamps the active tenant when the input carries none', async () => {
    const device = await runAs(TENANT_A, () => methods.createDevice({ userId: user }));

    expect(device.tenantId).toBe(TENANT_A);
  });
});

describe('getDevice', () => {
  it('returns null for a malformed id', async () => {
    await expect(methods.getDevice('nope')).resolves.toBeNull();
  });

  it("does not return another tenant's device", async () => {
    const device = await runAs(TENANT_A, () => methods.createDevice({ userId: user }));

    await expect(
      runAs(TENANT_B, () => methods.getDevice(device._id!.toString())),
    ).resolves.toBeNull();
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

  it('returns no results for a malformed user id', async () => {
    await expect(methods.listDevices({ userId: 'not-an-id' })).resolves.toEqual([]);
  });

  it('filters by an explicit tenantId when no tenant context is active', async () => {
    await runAs(TENANT_A, () => methods.createDevice({ userId: user, deviceName: 'A' }));
    await runAs(TENANT_B, () => methods.createDevice({ userId: user, deviceName: 'B' }));

    const scoped = await methods.listDevices({ tenantId: TENANT_A });
    expect(scoped).toHaveLength(1);
    expect(scoped[0].tenantId).toBe(TENANT_A);
  });

  it('keeps the active tenant context authoritative over an explicit tenantId', async () => {
    await runAs(TENANT_A, () => methods.createDevice({ userId: user, deviceName: 'A' }));
    await runAs(TENANT_B, () => methods.createDevice({ userId: user, deviceName: 'B' }));

    const listed = await runAs(TENANT_A, () => methods.listDevices({ tenantId: TENANT_B }));
    expect(listed).toHaveLength(1);
    expect(listed[0].tenantId).toBe(TENANT_A);
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

  it("does not patch another tenant's device", async () => {
    const device = await runAs(TENANT_A, () => methods.createDevice({ userId: user }));

    await expect(
      runAs(TENANT_B, () => methods.updateDevice(device._id!.toString(), { deviceName: 'X' })),
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
