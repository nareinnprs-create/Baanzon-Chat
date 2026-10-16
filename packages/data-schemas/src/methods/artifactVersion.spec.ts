import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IArtifact, IArtifactVersion } from '..';
import { createArtifactVersionMethods, ARTIFACT_VERSION_LIST_MAX_LIMIT } from './artifactVersion';
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
let Artifact: mongoose.Model<IArtifact>;
let ArtifactVersion: mongoose.Model<IArtifactVersion>;
let methods: ReturnType<typeof createArtifactVersionMethods>;

const user = new mongoose.Types.ObjectId().toString();

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

async function seedArtifact(): Promise<IArtifact> {
  const artifact = await new Artifact({ title: 'A', type: 'code', user, currentVersion: 0 }).save();
  return artifact.toObject() as IArtifact;
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  Artifact = mongoose.models.Artifact as mongoose.Model<IArtifact>;
  ArtifactVersion = mongoose.models.ArtifactVersion as mongoose.Model<IArtifactVersion>;
  methods = createArtifactVersionMethods(mongoose);
  await ArtifactVersion.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([Artifact.deleteMany({}), ArtifactVersion.deleteMany({})]);
});

describe('createArtifactVersion', () => {
  it('assigns sequential versions and advances the artifact counter', async () => {
    const artifact = await seedArtifact();
    const artifactId = artifact._id!.toString();

    const first = await methods.createArtifactVersion({
      artifactId,
      createdBy: user,
      content: 'one',
      language: 'typescript',
    });
    const second = await methods.createArtifactVersion({
      artifactId,
      createdBy: user,
      content: 'two',
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(second.content).toBe('two');
    expect(second.language).toBeUndefined();

    const refreshed = await Artifact.findById(artifactId).lean<IArtifact>();
    expect(refreshed?.currentVersion).toBe(2);
  });

  it('rejects invalid ids', async () => {
    await expect(
      methods.createArtifactVersion({ artifactId: 'bad', createdBy: user, content: 'x' }),
    ).rejects.toThrow(/artifactId is required/i);
    await expect(
      methods.createArtifactVersion({ artifactId: new mongoose.Types.ObjectId().toString(), createdBy: 'bad', content: 'x' }),
    ).rejects.toThrow(/createdBy is required/i);
  });

  it('enforces one row per (artifactId, version)', async () => {
    const artifact = await seedArtifact();
    const artifactId = artifact._id!.toString();
    await methods.createArtifactVersion({ artifactId, createdBy: user, content: 'one' });

    await expect(
      new ArtifactVersion({ artifactId, version: 1, content: 'dup', createdBy: user }).save(),
    ).rejects.toThrow();
  });
});

describe('getArtifactVersion / getLatestArtifactVersion', () => {
  it('fetches a revision and the newest revision', async () => {
    const artifact = await seedArtifact();
    const artifactId = artifact._id!.toString();
    await methods.createArtifactVersion({ artifactId, createdBy: user, content: 'one' });
    await methods.createArtifactVersion({ artifactId, createdBy: user, content: 'two' });

    expect((await methods.getArtifactVersion(artifactId, 1))?.content).toBe('one');
    expect((await methods.getLatestArtifactVersion(artifactId))?.content).toBe('two');
    expect(await methods.getArtifactVersion('bad', 1)).toBeNull();
    expect(await methods.getArtifactVersion(artifactId, 9)).toBeNull();
    expect(await methods.getLatestArtifactVersion('bad')).toBeNull();
  });
});

describe('listArtifactVersions / deleteArtifactVersionsForArtifact', () => {
  it('lists newest first, caps the page and deletes them all', async () => {
    const artifact = await seedArtifact();
    const artifactId = artifact._id!.toString();
    await methods.createArtifactVersion({ artifactId, createdBy: user, content: 'one' });
    await methods.createArtifactVersion({ artifactId, createdBy: user, content: 'two' });
    await methods.createArtifactVersion({ artifactId, createdBy: user, content: 'three' });

    expect((await methods.listArtifactVersions(artifactId)).map((v) => v.version)).toEqual([
      3, 2, 1,
    ]);
    expect(await methods.listArtifactVersions(artifactId, { limit: 2 })).toHaveLength(2);
    expect(
      await methods.listArtifactVersions(artifactId, {
        limit: ARTIFACT_VERSION_LIST_MAX_LIMIT + 50,
      }),
    ).toHaveLength(3);
    expect(await methods.listArtifactVersions('bad')).toEqual([]);

    expect(await methods.deleteArtifactVersionsForArtifact(artifactId)).toBe(3);
    expect(await methods.deleteArtifactVersionsForArtifact(artifactId)).toBe(0);
    expect(await methods.deleteArtifactVersionsForArtifact('bad')).toBe(0);
  });
});

describe('tenant isolation', () => {
  it('keeps revisions invisible across tenants', async () => {
    const artifact = await seedArtifact();
    const artifactId = artifact._id!.toString();
    await runAs(TENANT_A, () =>
      methods.createArtifactVersion({ artifactId, createdBy: user, content: 'alpha' }),
    );

    expect(await runAs(TENANT_B, () => methods.listArtifactVersions(artifactId))).toEqual([]);
    expect(await runAs(TENANT_B, () => methods.getLatestArtifactVersion(artifactId))).toBeNull();
  });
});
