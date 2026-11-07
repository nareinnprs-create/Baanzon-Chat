import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IPlanEntitlement } from '~/types/planEntitlement';
import { createPlanEntitlementMethods, type PlanEntitlementMethods } from './planEntitlement';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let PlanEntitlement: mongoose.Model<IPlanEntitlement>;
let methods: PlanEntitlementMethods;
let modelsToCleanup: string[] = [];

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  const models = createModels(mongoose);
  modelsToCleanup = Object.keys(models);
  Object.assign(mongoose.models, models);

  PlanEntitlement = mongoose.models.PlanEntitlement as mongoose.Model<IPlanEntitlement>;
  methods = createPlanEntitlementMethods(mongoose);

  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();

  for (const modelName of modelsToCleanup) {
    if (mongoose.models[modelName]) {
      delete mongoose.models[modelName];
    }
  }
});

afterEach(async () => {
  await PlanEntitlement.deleteMany({});
});

describe('PlanEntitlement methods', () => {
  const organizationId = '64b64b64b64b64b64b64b640';
  const otherOrganizationId = '64b64b64b64b64b64b64b641';

  it('upserts a global entitlement idempotently (one row per plan/resource/scope)', async () => {
    const created = await methods.upsertPlanEntitlement({
      plan: 'free',
      resource: 'tokens',
      scope: 'global',
      limit: 100000,
    });
    expect(created.limit).toBe(100000);
    expect(created.scopeId ?? null).toBeNull();

    const updated = await methods.upsertPlanEntitlement({
      plan: 'free',
      resource: 'tokens',
      scope: 'global',
      limit: 200000,
    });
    expect(String(updated._id)).toBe(String(created._id));
    expect(await PlanEntitlement.countDocuments({ plan: 'free', resource: 'tokens' })).toBe(1);
    expect((await methods.listPlanEntitlements())[0].limit).toBe(200000);
  });

  it('upserts an organization-scoped entitlement with the scopeId stored', async () => {
    const entitlement = await methods.upsertPlanEntitlement({
      plan: 'pro',
      resource: 'workflowExecutions',
      scope: 'organization',
      scopeId: organizationId,
      limit: 500,
    });
    expect(String(entitlement.scopeId)).toBe(organizationId);
    expect(entitlement.limit).toBe(500);
  });

  it('lists global entitlements globally, and global + organization per org', async () => {
    await methods.upsertPlanEntitlement({
      plan: 'free',
      resource: 'tokens',
      scope: 'global',
      limit: 1000,
    });
    await methods.upsertPlanEntitlement({
      plan: 'pro',
      resource: 'search',
      scope: 'organization',
      scopeId: organizationId,
      limit: 20,
    });
    await methods.upsertPlanEntitlement({
      plan: 'basic',
      resource: 'storage',
      scope: 'organization',
      scopeId: otherOrganizationId,
      limit: 5,
    });

    const globalOnly = await methods.listPlanEntitlements();
    expect(globalOnly).toHaveLength(1);
    expect(globalOnly[0].scope).toBe('global');

    const forOrg = await methods.listPlanEntitlements(organizationId);
    expect(forOrg).toHaveLength(2);
    expect(
      forOrg.every((row) => row.scope === 'global' || String(row.scopeId) === organizationId),
    ).toBe(true);
  });

  it('keeps one row per plan/resource/scope tuple (a global row does not collide with an org row)', async () => {
    await methods.upsertPlanEntitlement({
      plan: 'free',
      resource: 'tokens',
      scope: 'global',
      limit: 1000,
    });
    await methods.upsertPlanEntitlement({
      plan: 'free',
      resource: 'tokens',
      scope: 'organization',
      scopeId: organizationId,
      limit: 100,
    });
    expect(await PlanEntitlement.countDocuments({ plan: 'free', resource: 'tokens' })).toBe(2);
  });

  it('rejects unknown plans, unknown resources, unknown scopes, bad limits, and bad scope shapes', async () => {
    await expect(
      methods.upsertPlanEntitlement({
        plan: 'ultra' as never,
        resource: 'tokens',
        scope: 'global',
        limit: 1,
      }),
    ).rejects.toThrow('Unknown entitlement plan');

    await expect(
      methods.upsertPlanEntitlement({
        plan: 'free',
        resource: 'quantum' as never,
        scope: 'global',
        limit: 1,
      }),
    ).rejects.toThrow('Unknown entitlement resource');

    await expect(
      methods.upsertPlanEntitlement({
        plan: 'free',
        resource: 'tokens',
        scope: 'tenant' as never,
        limit: 1,
      }),
    ).rejects.toThrow('Unknown entitlement scope');

    await expect(
      methods.upsertPlanEntitlement({
        plan: 'free',
        resource: 'tokens',
        scope: 'global',
        limit: -2,
      }),
    ).rejects.toThrow('An entitlement limit must be a finite number at or above -1');

    await expect(
      methods.upsertPlanEntitlement({
        plan: 'free',
        resource: 'tokens',
        scope: 'global',
        scopeId: organizationId,
        limit: 1,
      }),
    ).rejects.toThrow('A global entitlement must not carry a scopeId');

    await expect(
      methods.upsertPlanEntitlement({
        plan: 'free',
        resource: 'tokens',
        scope: 'organization',
        limit: 1,
      }),
    ).rejects.toThrow('An organization entitlement requires a valid scopeId');

    await expect(
      methods.upsertPlanEntitlement({
        plan: 'free',
        resource: 'tokens',
        scope: 'organization',
        scopeId: 'not-an-id',
        limit: 1,
      }),
    ).rejects.toThrow('An organization entitlement requires a valid scopeId');
  });

  it('deletes an entitlement and reports a zero count when nothing matched', async () => {
    await methods.upsertPlanEntitlement({
      plan: 'pro',
      resource: 'agentCompute',
      scope: 'organization',
      scopeId: organizationId,
      limit: 10,
    });
    const deleted = await methods.deletePlanEntitlement({
      plan: 'pro',
      resource: 'agentCompute',
      scope: 'organization',
      scopeId: organizationId,
      limit: 10,
    });
    expect(deleted.deletedCount).toBe(1);

    const missing = await methods.deletePlanEntitlement({
      plan: 'pro',
      resource: 'agentCompute',
      scope: 'organization',
      scopeId: organizationId,
      limit: 10,
    });
    expect(missing.deletedCount).toBe(0);
  });
});
