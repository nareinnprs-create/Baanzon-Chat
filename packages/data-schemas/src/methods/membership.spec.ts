import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IMembership } from '..';
import { tenantStorage } from '../config/tenantContext';
import { createMembershipMethods } from './membership';
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
let Membership: mongoose.Model<IMembership>;
let methods: ReturnType<typeof createMembershipMethods>;

const orgId = new mongoose.Types.ObjectId().toString();
const otherOrgId = new mongoose.Types.ObjectId().toString();
const userId = new mongoose.Types.ObjectId().toString();
const otherUserId = new mongoose.Types.ObjectId().toString();
const inviterId = new mongoose.Types.ObjectId().toString();

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  Membership = mongoose.models.Membership as mongoose.Model<IMembership>;
  methods = createMembershipMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Membership.deleteMany({});
});

describe('addMembership', () => {
  it('creates an active member by default', async () => {
    const membership = await methods.addMembership({ organizationId: orgId, userId });

    expect(membership).toMatchObject({ role: 'member', status: 'active' });
    expect(membership.organizationId.toString()).toBe(orgId);
    expect(membership.userId.toString()).toBe(userId);
  });

  it('records the inviter and requested role', async () => {
    const membership = await methods.addMembership({
      organizationId: orgId,
      userId,
      role: 'admin',
      status: 'invited',
      invitedBy: inviterId,
    });

    expect(membership.role).toBe('admin');
    expect(membership.status).toBe('invited');
    expect(membership.invitedBy?.toString()).toBe(inviterId);
  });

  it('is idempotent per (org, user), updating instead of duplicating', async () => {
    await methods.addMembership({ organizationId: orgId, userId });
    const updated = await methods.addMembership({ organizationId: orgId, userId, role: 'owner' });

    expect(updated.role).toBe('owner');
    expect(await Membership.countDocuments({ organizationId: orgId, userId })).toBe(1);
  });

  it('rejects invalid organization or user ids', async () => {
    await expect(methods.addMembership({ organizationId: 'bad', userId })).rejects.toThrow(
      /organizationId/i,
    );
    await expect(methods.addMembership({ organizationId: orgId, userId: 'bad' })).rejects.toThrow(
      /userId/i,
    );
  });
});

describe('getMembership', () => {
  it('finds a membership by org and user', async () => {
    await methods.addMembership({ organizationId: orgId, userId });
    const found = await methods.getMembership(orgId, userId);
    expect(found?.userId.toString()).toBe(userId);
  });

  it('returns null for a missing pair or invalid id', async () => {
    expect(await methods.getMembership(orgId, otherUserId)).toBeNull();
    expect(await methods.getMembership('bad', userId)).toBeNull();
  });
});

describe('listings', () => {
  it('lists an organization membership roster', async () => {
    await methods.addMembership({ organizationId: orgId, userId });
    await methods.addMembership({ organizationId: orgId, userId: otherUserId });
    await methods.addMembership({ organizationId: otherOrgId, userId });

    const roster = await methods.listOrganizationMemberships(orgId);
    expect(roster).toHaveLength(2);
    expect(await methods.listOrganizationMemberships('bad')).toEqual([]);
  });

  it("lists a user's active memberships only", async () => {
    await methods.addMembership({ organizationId: orgId, userId });
    await methods.addMembership({ organizationId: otherOrgId, userId, status: 'suspended' });

    const mine = await methods.listUserMemberships(userId);
    expect(mine).toHaveLength(1);
    expect(mine[0].organizationId.toString()).toBe(orgId);
    expect(await methods.listUserMemberships('bad')).toEqual([]);
  });
});

describe('updateMembership', () => {
  it('changes role and status', async () => {
    await methods.addMembership({ organizationId: orgId, userId });
    const updated = await methods.updateMembership(orgId, userId, {
      role: 'viewer',
      status: 'suspended',
    });

    expect(updated).toMatchObject({ role: 'viewer', status: 'suspended' });
  });

  it('returns null when nothing matches or the id is invalid', async () => {
    expect(await methods.updateMembership(orgId, userId, { role: 'admin' })).toBeNull();
    expect(await methods.updateMembership('bad', userId, { role: 'admin' })).toBeNull();
  });
});

describe('removeMembership', () => {
  it('deletes once and then reports nothing removed', async () => {
    await methods.addMembership({ organizationId: orgId, userId });
    expect(await methods.removeMembership(orgId, userId)).toBe(true);
    expect(await methods.removeMembership(orgId, userId)).toBe(false);
    expect(await methods.removeMembership('bad', userId)).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('keeps memberships invisible across tenants', async () => {
    await runAs(TENANT_A, () => methods.addMembership({ organizationId: orgId, userId }));
    expect(await runAs(TENANT_B, () => methods.listOrganizationMemberships(orgId))).toEqual([]);
    expect(await methods.getMembership(orgId, userId)).not.toBeNull();
  });
});
