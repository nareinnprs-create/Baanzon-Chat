import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IFlagOverride } from '~/types/flagOverride';
import { createFlagOverrideMethods, type FlagOverrideMethods } from './flagOverride';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let FlagOverride: mongoose.Model<IFlagOverride>;
let methods: FlagOverrideMethods;
let modelsToCleanup: string[] = [];

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  const models = createModels(mongoose);
  modelsToCleanup = Object.keys(models);
  Object.assign(mongoose.models, models);

  FlagOverride = mongoose.models.FlagOverride as mongoose.Model<IFlagOverride>;
  methods = createFlagOverrideMethods(mongoose);

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
  await FlagOverride.deleteMany({});
});

describe('FlagOverride methods', () => {
  const organizationId = '64b64b64b64b64b64b64b640';
  const otherOrganizationId = '64b64b64b64b64b64b64b641';

  it('upserts a global override idempotently (one row per key/scope)', async () => {
    const created = await methods.upsertFlagOverride({
      key: 'workspace.projects',
      scope: 'global',
      value: false,
    });
    expect(created.value).toBe(false);
    expect(created.scopeId ?? null).toBeNull();

    const updated = await methods.upsertFlagOverride({
      key: 'workspace.projects',
      scope: 'global',
      value: true,
    });
    expect(String(updated._id)).toBe(String(created._id));
    expect(await FlagOverride.countDocuments({ key: 'workspace.projects' })).toBe(1);
    expect((await methods.listFlagOverrides())[0].value).toBe(true);
  });

  it('upserts an organization-scoped override with the scopeId stored', async () => {
    const override = await methods.upsertFlagOverride({
      key: 'deepResearch.ui',
      scope: 'organization',
      scopeId: organizationId,
      value: false,
    });
    expect(String(override.scopeId)).toBe(organizationId);
    expect(override.value).toBe(false);
  });

  it('lists global overrides globally, and global + organization per org', async () => {
    await methods.upsertFlagOverride({ key: 'workspace.projects', scope: 'global', value: false });
    await methods.upsertFlagOverride({
      key: 'deepResearch.ui',
      scope: 'organization',
      scopeId: organizationId,
      value: false,
    });
    await methods.upsertFlagOverride({
      key: 'workflow.builder',
      scope: 'organization',
      scopeId: otherOrganizationId,
      value: false,
    });

    const globalOnly = await methods.listFlagOverrides();
    expect(globalOnly).toHaveLength(1);
    expect(globalOnly[0].scope).toBe('global');

    const forOrg = await methods.listFlagOverrides(organizationId);
    expect(forOrg).toHaveLength(2);
    expect(
      forOrg.every((row) => row.scope === 'global' || String(row.scopeId) === organizationId),
    ).toBe(true);
  });

  it('rejects unknown keys, unknown scopes, and bad scope shapes', async () => {
    await expect(
      methods.upsertFlagOverride({ key: 'not.a.flag', scope: 'global', value: true }),
    ).rejects.toThrow('Unknown feature flag');

    await expect(
      methods.upsertFlagOverride({
        key: 'workspace.projects',
        scope: 'tenant' as never,
        value: true,
      }),
    ).rejects.toThrow('Unknown feature flag scope');

    await expect(
      methods.upsertFlagOverride({
        key: 'workspace.projects',
        scope: 'global',
        scopeId: organizationId,
        value: true,
      }),
    ).rejects.toThrow('A global flag override must not carry a scopeId');

    await expect(
      methods.upsertFlagOverride({ key: 'workspace.projects', scope: 'organization', value: true }),
    ).rejects.toThrow('An organization flag override requires a valid scopeId');

    await expect(
      methods.upsertFlagOverride({
        key: 'workspace.projects',
        scope: 'organization',
        scopeId: 'not-an-id',
        value: true,
      }),
    ).rejects.toThrow('An organization flag override requires a valid scopeId');
  });

  it('deletes an override and reports a zero count when nothing matched', async () => {
    await methods.upsertFlagOverride({
      key: 'workflow.builder',
      scope: 'organization',
      scopeId: organizationId,
      value: false,
    });
    const deleted = await methods.deleteFlagOverride({
      key: 'workflow.builder',
      scope: 'organization',
      scopeId: organizationId,
      value: false,
    });
    expect(deleted.deletedCount).toBe(1);

    const missing = await methods.deleteFlagOverride({
      key: 'workflow.builder',
      scope: 'organization',
      scopeId: organizationId,
      value: false,
    });
    expect(missing.deletedCount).toBe(0);
  });
});
