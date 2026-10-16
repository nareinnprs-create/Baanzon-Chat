import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IToolVersion } from '..';
import { createToolVersionMethods, TOOL_VERSION_LIST_MAX_LIMIT } from './toolVersion';
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
let ToolVersion: mongoose.Model<IToolVersion>;
let methods: ReturnType<typeof createToolVersionMethods>;

const toolId = new mongoose.Types.ObjectId().toString();
const user = new mongoose.Types.ObjectId().toString();

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  ToolVersion = mongoose.models.ToolVersion as mongoose.Model<IToolVersion>;
  methods = createToolVersionMethods(mongoose);
  await ToolVersion.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await ToolVersion.deleteMany({});
});

describe('createToolVersion', () => {
  it('assigns sequential 1-based versions', async () => {
    const first = await methods.createToolVersion({ toolId, createdBy: user, description: 'v1' });
    const second = await methods.createToolVersion({ toolId, createdBy: user, changelog: 'v2' });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(second.changelog).toBe('v2');
    expect(second.description).toBeUndefined();
  });

  it('rejects invalid ids', async () => {
    await expect(methods.createToolVersion({ toolId: 'bad', createdBy: user })).rejects.toThrow(
      /toolId is required/i,
    );
    await expect(methods.createToolVersion({ toolId, createdBy: 'bad' })).rejects.toThrow(
      /createdBy is required/i,
    );
  });

  it('enforces one row per (toolId, version)', async () => {
    await methods.createToolVersion({ toolId, createdBy: user });
    await expect(new ToolVersion({ toolId, version: 1, createdBy: user }).save()).rejects.toThrow();
  });
});

describe('getToolVersion / getLatestToolVersion', () => {
  it('fetches a revision and the newest revision', async () => {
    await methods.createToolVersion({ toolId, createdBy: user, description: 'one' });
    await methods.createToolVersion({ toolId, createdBy: user, description: 'two' });

    expect((await methods.getToolVersion(toolId, 1))?.description).toBe('one');
    expect((await methods.getLatestToolVersion(toolId))?.description).toBe('two');
  });

  it('returns null for unknown or invalid lookups', async () => {
    expect(await methods.getToolVersion('bad', 1)).toBeNull();
    expect(await methods.getToolVersion(toolId, 1.5)).toBeNull();
    expect(await methods.getToolVersion(toolId, 9)).toBeNull();
    expect(await methods.getLatestToolVersion('bad')).toBeNull();
  });
});

describe('listToolVersions', () => {
  it('returns newest first and caps the page', async () => {
    await methods.createToolVersion({ toolId, createdBy: user });
    await methods.createToolVersion({ toolId, createdBy: user });
    await methods.createToolVersion({ toolId, createdBy: user });

    expect((await methods.listToolVersions(toolId)).map((v) => v.version)).toEqual([3, 2, 1]);
    expect(await methods.listToolVersions(toolId, { limit: 2 })).toHaveLength(2);
    expect(await methods.listToolVersions(toolId, { limit: TOOL_VERSION_LIST_MAX_LIMIT + 50 })).toHaveLength(
      3,
    );
    expect(await methods.listToolVersions('bad')).toEqual([]);
  });
});

describe('deleteToolVersionsForTool', () => {
  it('removes every revision and reports the count', async () => {
    await methods.createToolVersion({ toolId, createdBy: user });
    await methods.createToolVersion({ toolId, createdBy: user });

    expect(await methods.deleteToolVersionsForTool(toolId)).toBe(2);
    expect(await methods.deleteToolVersionsForTool(toolId)).toBe(0);
    expect(await methods.deleteToolVersionsForTool('bad')).toBe(0);
  });
});

describe('tenant isolation', () => {
  it('keeps revisions invisible across tenants', async () => {
    await runAs(TENANT_A, () => methods.createToolVersion({ toolId, createdBy: user }));

    expect(await runAs(TENANT_B, () => methods.listToolVersions(toolId))).toEqual([]);
    expect(await runAs(TENANT_B, () => methods.getLatestToolVersion(toolId))).toBeNull();
  });
});
