import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IToolPermission } from '..';
import { createToolPermissionMethods } from './toolPermission';
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
let ToolPermission: mongoose.Model<IToolPermission>;
let methods: ReturnType<typeof createToolPermissionMethods>;

const toolId = new mongoose.Types.ObjectId().toString();
const otherToolId = new mongoose.Types.ObjectId().toString();
const user = new mongoose.Types.ObjectId().toString();
const principalId = new mongoose.Types.ObjectId().toString();

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  ToolPermission = mongoose.models.ToolPermission as mongoose.Model<IToolPermission>;
  methods = createToolPermissionMethods(mongoose);
  await ToolPermission.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await ToolPermission.deleteMany({});
});

describe('grantToolPermission', () => {
  it('creates a granted row by default and is idempotent per principal', async () => {
    const grant = await methods.grantToolPermission({
      toolId,
      principalType: 'user',
      principalId,
      createdBy: user,
    });
    expect(grant).toMatchObject({ principalType: 'user', principalId, granted: true });
    expect(grant.toolId.toString()).toBe(toolId);

    const updated = await methods.grantToolPermission({
      toolId,
      principalType: 'user',
      principalId,
      createdBy: user,
      granted: false,
    });
    expect(updated.granted).toBe(false);
    expect(await ToolPermission.countDocuments({})).toBe(1);
  });

  it('rejects invalid ids and a blank principal', async () => {
    await expect(
      methods.grantToolPermission({
        toolId: 'bad',
        principalType: 'user',
        principalId,
        createdBy: user,
      }),
    ).rejects.toThrow(/toolId is required/i);
    await expect(
      methods.grantToolPermission({ toolId, principalType: 'user', principalId, createdBy: 'bad' }),
    ).rejects.toThrow(/createdBy is required/i);
    await expect(
      methods.grantToolPermission({
        toolId,
        principalType: 'user',
        principalId: '  ',
        createdBy: user,
      }),
    ).rejects.toThrow(/principalId is required/i);
  });
});

describe('getToolPermission', () => {
  it('scopes the lookup to the exact principal', async () => {
    await methods.grantToolPermission({
      toolId,
      principalType: 'user',
      principalId,
      createdBy: user,
    });
    const found = await methods.getToolPermission({ toolId, principalType: 'user', principalId });
    expect(found?.granted).toBe(true);
    expect(
      await methods.getToolPermission({ toolId, principalType: 'role', principalId }),
    ).toBeNull();
    expect(
      await methods.getToolPermission({ toolId: 'bad', principalType: 'user', principalId }),
    ).toBeNull();
  });
});

describe('listToolPermissions / listToolPermissionsForPrincipal', () => {
  it('lists grants per tool and per principal', async () => {
    await methods.grantToolPermission({
      toolId,
      principalType: 'user',
      principalId,
      createdBy: user,
    });
    await methods.grantToolPermission({
      toolId,
      principalType: 'role',
      principalId: 'admin',
      createdBy: user,
    });
    await methods.grantToolPermission({
      toolId: otherToolId,
      principalType: 'user',
      principalId,
      createdBy: user,
    });

    expect(await methods.listToolPermissions(toolId)).toHaveLength(2);
    expect(await methods.listToolPermissions('bad')).toEqual([]);

    expect(await methods.listToolPermissionsForPrincipal('user', principalId)).toHaveLength(2);
    expect(await methods.listToolPermissionsForPrincipal('user', '  ')).toEqual([]);
  });
});

describe('revokeToolPermission', () => {
  it('removes the grant once', async () => {
    await methods.grantToolPermission({
      toolId,
      principalType: 'user',
      principalId,
      createdBy: user,
    });
    const ref = { toolId, principalType: 'user' as const, principalId };
    expect(await methods.revokeToolPermission(ref)).toBe(true);
    expect(await methods.revokeToolPermission(ref)).toBe(false);
    expect(await methods.revokeToolPermission({ ...ref, toolId: 'bad' })).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('keeps grants invisible across tenants', async () => {
    await runAs(TENANT_A, () =>
      methods.grantToolPermission({ toolId, principalType: 'user', principalId, createdBy: user }),
    );

    expect(await runAs(TENANT_B, () => methods.listToolPermissions(toolId))).toEqual([]);
  });
});
