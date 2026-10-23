import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IOrganization, IMembership, IWorkspace } from '..';
import { createOrganizationMethods, slugifyOrganizationName } from './organization';
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
let Organization: mongoose.Model<IOrganization>;
let Membership: mongoose.Model<IMembership>;
let Workspace: mongoose.Model<IWorkspace>;
let methods: ReturnType<typeof createOrganizationMethods>;

const owner = new mongoose.Types.ObjectId().toString();
const member = new mongoose.Types.ObjectId().toString();
const stranger = new mongoose.Types.ObjectId().toString();

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  Organization = mongoose.models.Organization as mongoose.Model<IOrganization>;
  Membership = mongoose.models.Membership as mongoose.Model<IMembership>;
  Workspace = mongoose.models.Workspace as mongoose.Model<IWorkspace>;
  methods = createOrganizationMethods(mongoose);
  await Promise.all([Organization.init(), Membership.init(), Workspace.init()]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    Organization.deleteMany({}),
    Membership.deleteMany({}),
    Workspace.deleteMany({}),
  ]);
});

describe('slugifyOrganizationName', () => {
  it('lowercases, dashes and trims a human name', () => {
    expect(slugifyOrganizationName('  Acme Widgets, Inc.  ')).toBe('acme-widgets-inc');
  });

  it('returns an empty string when nothing usable remains', () => {
    expect(slugifyOrganizationName('!!!')).toBe('');
  });
});

describe('createOrganization', () => {
  it('derives a slug from the name and applies defaults', async () => {
    const org = await methods.createOrganization({ name: 'Acme Rockets', owner });

    expect(org).toMatchObject({
      name: 'Acme Rockets',
      slug: 'acme-rockets',
      status: 'active',
      isPersonal: false,
    });
    expect(org.owner.toString()).toBe(owner);
  });

  it('slugifies an explicitly supplied slug', async () => {
    const org = await methods.createOrganization({
      name: 'Acme',
      slug: 'My Custom Slug',
      owner,
    });
    expect(org.slug).toBe('my-custom-slug');
  });

  it('gives a personal organization a stable owner-scoped slug', async () => {
    const org = await methods.createOrganization({ name: 'Personal', owner, isPersonal: true });
    expect(org.slug).toBe(`personal-${owner}`);
    expect(org.isPersonal).toBe(true);
  });

  it('falls back to a generic slug when the name has no usable characters', async () => {
    const org = await methods.createOrganization({ name: '!!!', owner });
    expect(org.slug).toBe('org');
  });

  it('rejects a missing name', async () => {
    await expect(methods.createOrganization({ name: '   ', owner })).rejects.toThrow(
      /name is required/i,
    );
  });

  it('enforces slug uniqueness within a tenant', async () => {
    await runAs(TENANT_A, async () => {
      await methods.createOrganization({ name: 'Acme', owner });
      await expect(methods.createOrganization({ name: 'Acme', owner })).rejects.toThrow();
    });
  });

  it('allows the same slug in different tenants', async () => {
    const a = await runAs(TENANT_A, () => methods.createOrganization({ name: 'Acme', owner }));
    const b = await runAs(TENANT_B, () => methods.createOrganization({ name: 'Acme', owner }));
    expect(a.slug).toBe('acme');
    expect(b.slug).toBe('acme');
  });
});

describe('getOrganization', () => {
  it('returns the organization by id', async () => {
    const created = await methods.createOrganization({ name: 'Acme', owner });
    const found = await methods.getOrganization(created._id!.toString());
    expect(found?.name).toBe('Acme');
  });

  it('returns null for an invalid or unknown id', async () => {
    expect(await methods.getOrganization('not-an-id')).toBeNull();
    expect(await methods.getOrganization(new mongoose.Types.ObjectId().toString())).toBeNull();
  });
});

describe('updateOrganization', () => {
  it('updates name, status and settings', async () => {
    const created = await methods.createOrganization({ name: 'Acme', owner });
    const updated = await methods.updateOrganization(created._id!.toString(), {
      name: 'Acme Corp',
      status: 'suspended',
      settings: { theme: 'dark' },
    });

    expect(updated).toMatchObject({
      name: 'Acme Corp',
      status: 'suspended',
      settings: { theme: 'dark' },
    });
  });

  it('rejects a blank name and ignores invalid ids', async () => {
    const created = await methods.createOrganization({ name: 'Acme', owner });
    await expect(
      methods.updateOrganization(created._id!.toString(), { name: '  ' }),
    ).rejects.toThrow(/name is required/i);
    expect(await methods.updateOrganization('nope', { name: 'X' })).toBeNull();
  });
});

describe('listOrganizationsForUser', () => {
  it('returns owned and actively-joined organizations, newest first', async () => {
    const owned = await methods.createOrganization({ name: 'Owned', owner });
    const joined = await methods.createOrganization({ name: 'Joined', owner: stranger });
    await new Membership({ organizationId: joined._id, userId: member, status: 'active' }).save();
    await methods.createOrganization({ name: 'Unrelated', owner: stranger });

    const forOwner = await methods.listOrganizationsForUser(owner);
    expect(forOwner.map((org) => org.name)).toEqual(['Owned']);

    const forMember = await methods.listOrganizationsForUser(member);
    expect(forMember.map((org) => org.name)).toEqual(['Joined']);
    expect(forMember[0]._id!.toString()).toBe(joined._id!.toString());
    expect(owned._id).toBeDefined();
  });

  it('excludes non-active memberships', async () => {
    const joined = await methods.createOrganization({ name: 'Joined', owner: stranger });
    await new Membership({
      organizationId: joined._id,
      userId: member,
      status: 'invited',
    }).save();

    expect(await methods.listOrganizationsForUser(member)).toEqual([]);
  });
});

describe('deleteOrganization', () => {
  it('removes the org and cascades to its memberships and workspaces', async () => {
    const org = await methods.createOrganization({ name: 'Acme', owner });
    await new Membership({ organizationId: org._id, userId: owner }).save();
    await new Workspace({ organizationId: org._id, name: 'W', slug: 'w', createdBy: owner }).save();

    expect(await methods.deleteOrganization(org._id!.toString())).toBe(true);
    expect(await Organization.countDocuments({})).toBe(0);
    expect(await Membership.countDocuments({})).toBe(0);
    expect(await Workspace.countDocuments({})).toBe(0);
  });

  it('returns false for an unknown id', async () => {
    expect(await methods.deleteOrganization(new mongoose.Types.ObjectId().toString())).toBe(false);
    expect(await methods.deleteOrganization('bad')).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('keeps organizations invisible across tenants', async () => {
    const a = await runAs(TENANT_A, () => methods.createOrganization({ name: 'Alpha', owner }));
    await runAs(TENANT_B, () => methods.createOrganization({ name: 'Beta', owner }));

    const seenFromB = await runAs(TENANT_B, () => methods.listOrganizationsForUser(owner));
    expect(seenFromB.map((org) => org.name)).toEqual(['Beta']);

    const hidden = await runAs(TENANT_B, () => methods.getOrganization(a._id!.toString()));
    expect(hidden).toBeNull();
  });
});
