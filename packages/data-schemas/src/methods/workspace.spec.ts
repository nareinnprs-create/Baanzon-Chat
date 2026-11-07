import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IWorkspace } from '..';
import { createWorkspaceMethods, slugifyWorkspaceName } from './workspace';
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
let Workspace: mongoose.Model<IWorkspace>;
let methods: ReturnType<typeof createWorkspaceMethods>;

const orgId = new mongoose.Types.ObjectId().toString();
const otherOrgId = new mongoose.Types.ObjectId().toString();
const creator = new mongoose.Types.ObjectId().toString();

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  Workspace = mongoose.models.Workspace as mongoose.Model<IWorkspace>;
  methods = createWorkspaceMethods(mongoose);
  await Workspace.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Workspace.deleteMany({});
});

describe('slugifyWorkspaceName', () => {
  it('normalizes a name into a slug', () => {
    expect(slugifyWorkspaceName('  Product Team  ')).toBe('product-team');
  });
});

describe('createWorkspace', () => {
  it('derives a slug and defaults visibility to org', async () => {
    const workspace = await methods.createWorkspace({
      organizationId: orgId,
      name: 'Product Team',
      createdBy: creator,
    });

    expect(workspace).toMatchObject({
      name: 'Product Team',
      slug: 'product-team',
      visibility: 'org',
    });
    expect(workspace.organizationId.toString()).toBe(orgId);
  });

  it('honors an explicit visibility and description', async () => {
    const workspace = await methods.createWorkspace({
      organizationId: orgId,
      name: 'Secret',
      createdBy: creator,
      visibility: 'private',
      description: 'internal',
    });

    expect(workspace.visibility).toBe('private');
    expect(workspace.description).toBe('internal');
  });

  it('rejects an invalid organization id or blank name', async () => {
    await expect(
      methods.createWorkspace({ organizationId: 'bad', name: 'X', createdBy: creator }),
    ).rejects.toThrow(/organizationId/i);
    await expect(
      methods.createWorkspace({ organizationId: orgId, name: '   ', createdBy: creator }),
    ).rejects.toThrow(/name is required/i);
  });

  it('enforces slug uniqueness within an organization', async () => {
    await methods.createWorkspace({ organizationId: orgId, name: 'Product', createdBy: creator });
    await expect(
      methods.createWorkspace({ organizationId: orgId, name: 'Product', createdBy: creator }),
    ).rejects.toThrow();

    const other = await methods.createWorkspace({
      organizationId: otherOrgId,
      name: 'Product',
      createdBy: creator,
    });
    expect(other.slug).toBe('product');
  });
});

describe('getWorkspace', () => {
  it('returns the workspace by id and null otherwise', async () => {
    const created = await methods.createWorkspace({
      organizationId: orgId,
      name: 'Product',
      createdBy: creator,
    });

    expect((await methods.getWorkspace(created._id!.toString()))?.name).toBe('Product');
    expect(await methods.getWorkspace(new mongoose.Types.ObjectId().toString())).toBeNull();
    expect(await methods.getWorkspace('bad')).toBeNull();
  });
});

describe('listWorkspaces', () => {
  it('lists a workspace per organization', async () => {
    await methods.createWorkspace({ organizationId: orgId, name: 'One', createdBy: creator });
    await methods.createWorkspace({ organizationId: orgId, name: 'Two', createdBy: creator });
    await methods.createWorkspace({
      organizationId: otherOrgId,
      name: 'Three',
      createdBy: creator,
    });

    expect(await methods.listWorkspaces(orgId)).toHaveLength(2);
    expect(await methods.listWorkspaces('bad')).toEqual([]);
  });
});

describe('updateWorkspace', () => {
  it('updates name, description and visibility', async () => {
    const created = await methods.createWorkspace({
      organizationId: orgId,
      name: 'Product',
      createdBy: creator,
    });

    const updated = await methods.updateWorkspace(created._id!.toString(), {
      name: 'Platform',
      description: 'core',
      visibility: 'private',
    });

    expect(updated).toMatchObject({ name: 'Platform', description: 'core', visibility: 'private' });
  });

  it('rejects a blank name and invalid ids', async () => {
    const created = await methods.createWorkspace({
      organizationId: orgId,
      name: 'Product',
      createdBy: creator,
    });

    await expect(methods.updateWorkspace(created._id!.toString(), { name: '  ' })).rejects.toThrow(
      /name is required/i,
    );
    expect(await methods.updateWorkspace('bad', { name: 'X' })).toBeNull();
  });
});

describe('deleteWorkspace', () => {
  it('deletes once and then reports nothing removed', async () => {
    const created = await methods.createWorkspace({
      organizationId: orgId,
      name: 'Product',
      createdBy: creator,
    });

    expect(await methods.deleteWorkspace(created._id!.toString())).toBe(true);
    expect(await methods.deleteWorkspace(created._id!.toString())).toBe(false);
    expect(await methods.deleteWorkspace('bad')).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('keeps workspaces invisible across tenants', async () => {
    const created = await runAs(TENANT_A, () =>
      methods.createWorkspace({ organizationId: orgId, name: 'Alpha', createdBy: creator }),
    );

    expect(await runAs(TENANT_B, () => methods.listWorkspaces(orgId))).toEqual([]);
    expect(await runAs(TENANT_B, () => methods.getWorkspace(created._id!.toString()))).toBeNull();
  });
});
