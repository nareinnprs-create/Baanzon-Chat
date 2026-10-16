import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { ITool, IToolVersion, IToolPermission } from '..';
import { tenantStorage } from '../config/tenantContext';
import { createToolMethods } from './tool';
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
let Tool: mongoose.Model<ITool>;
let ToolVersion: mongoose.Model<IToolVersion>;
let ToolPermission: mongoose.Model<IToolPermission>;
let methods: ReturnType<typeof createToolMethods>;

const user = new mongoose.Types.ObjectId().toString();
const otherUser = new mongoose.Types.ObjectId().toString();

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  Tool = mongoose.models.Tool as mongoose.Model<ITool>;
  ToolVersion = mongoose.models.ToolVersion as mongoose.Model<IToolVersion>;
  ToolPermission = mongoose.models.ToolPermission as mongoose.Model<IToolPermission>;
  methods = createToolMethods(mongoose);
  await Tool.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    Tool.deleteMany({}),
    ToolVersion.deleteMany({}),
    ToolPermission.deleteMany({}),
  ]);
});

describe('createTool', () => {
  it('creates an enabled tool with a trimmed name', async () => {
    const tool = await methods.createTool({
      name: '  Web Search  ',
      type: 'native',
      createdBy: user,
      description: 'search the web',
    });

    expect(tool).toMatchObject({
      name: 'Web Search',
      type: 'native',
      enabled: true,
      description: 'search the web',
    });
    expect(tool.createdBy.toString()).toBe(user);
  });

  it('honours an explicit disabled state', async () => {
    const tool = await methods.createTool({
      name: 'Disabled',
      type: 'custom',
      createdBy: user,
      enabled: false,
    });
    expect(tool.enabled).toBe(false);
  });

  it('rejects a blank name and an invalid owner', async () => {
    await expect(
      methods.createTool({ name: '   ', type: 'native', createdBy: user }),
    ).rejects.toThrow(/name is required/i);
    await expect(
      methods.createTool({ name: 'Ok', type: 'native', createdBy: 'not-an-id' }),
    ).rejects.toThrow(/createdBy is required/i);
  });

  it('enforces a unique name within a tenant but allows it across tenants', async () => {
    await runAs(TENANT_A, () =>
      methods.createTool({ name: 'Dup', type: 'native', createdBy: user }),
    );
    await expect(
      runAs(TENANT_A, () => methods.createTool({ name: 'Dup', type: 'native', createdBy: user })),
    ).rejects.toThrow();

    const b = await runAs(TENANT_B, () =>
      methods.createTool({ name: 'Dup', type: 'native', createdBy: user }),
    );
    expect(b.name).toBe('Dup');
  });
});

describe('getTool / getToolByName', () => {
  it('returns a tool by id and by name', async () => {
    const created = await methods.createTool({ name: 'Calc', type: 'native', createdBy: user });
    expect((await methods.getTool(created._id!.toString()))?.name).toBe('Calc');
    expect((await methods.getToolByName('Calc'))?.name).toBe('Calc');
  });

  it('returns null for unknown, blank or invalid lookups', async () => {
    expect(await methods.getTool('not-an-id')).toBeNull();
    expect(await methods.getTool(new mongoose.Types.ObjectId().toString())).toBeNull();
    expect(await methods.getToolByName('  ')).toBeNull();
    expect(await methods.getToolByName('missing')).toBeNull();
  });
});

describe('listTools', () => {
  it('filters by type and availability', async () => {
    await methods.createTool({ name: 'A', type: 'native', createdBy: user });
    await methods.createTool({ name: 'B', type: 'mcp', createdBy: user });
    await methods.createTool({ name: 'C', type: 'native', createdBy: user, enabled: false });

    expect((await methods.listTools({ type: 'native' })).map((t) => t.name)).toEqual(['A', 'C']);
    expect((await methods.listTools({ enabledOnly: true })).map((t) => t.name)).toEqual([
      'A',
      'B',
    ]);
    expect(await methods.listTools()).toHaveLength(3);
  });
});

describe('updateTool', () => {
  it('updates description, definition and enabled', async () => {
    const tool = await methods.createTool({ name: 'T', type: 'native', createdBy: user });
    const updated = await methods.updateTool(tool._id!.toString(), {
      description: 'updated',
      definition: { params: {} },
      enabled: false,
    });

    expect(updated).toMatchObject({
      description: 'updated',
      definition: { params: {} },
      enabled: false,
    });
  });

  it('ignores an invalid id', async () => {
    expect(await methods.updateTool('bad', { enabled: false })).toBeNull();
  });
});

describe('deleteTool', () => {
  it('removes the tool and cascades to its versions and grants', async () => {
    const tool = await methods.createTool({ name: 'T', type: 'native', createdBy: user });
    await new ToolVersion({ toolId: tool._id, version: 1, createdBy: user }).save();
    await new ToolPermission({
      toolId: tool._id,
      principalType: 'user',
      principalId: otherUser,
      createdBy: user,
    }).save();

    expect(await methods.deleteTool(tool._id!.toString())).toBe(true);
    expect(await Tool.countDocuments({})).toBe(0);
    expect(await ToolVersion.countDocuments({})).toBe(0);
    expect(await ToolPermission.countDocuments({})).toBe(0);
  });

  it('returns false for an unknown or invalid id', async () => {
    expect(await methods.deleteTool(new mongoose.Types.ObjectId().toString())).toBe(false);
    expect(await methods.deleteTool('bad')).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('keeps tools invisible across tenants', async () => {
    await runAs(TENANT_A, () =>
      methods.createTool({ name: 'Alpha', type: 'native', createdBy: user }),
    );

    expect(await runAs(TENANT_B, () => methods.listTools())).toEqual([]);
    expect(await runAs(TENANT_B, () => methods.getToolByName('Alpha'))).toBeNull();
  });
});
