import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IArtifact, IArtifactVersion } from '..';
import { createArtifactMethods, ARTIFACT_LIST_MAX_LIMIT } from './artifact';
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
let methods: ReturnType<typeof createArtifactMethods>;

const user = new mongoose.Types.ObjectId().toString();
const otherUser = new mongoose.Types.ObjectId().toString();

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  Artifact = mongoose.models.Artifact as mongoose.Model<IArtifact>;
  ArtifactVersion = mongoose.models.ArtifactVersion as mongoose.Model<IArtifactVersion>;
  methods = createArtifactMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([Artifact.deleteMany({}), ArtifactVersion.deleteMany({})]);
});

describe('createArtifact', () => {
  it('starts an artifact at version zero with a trimmed title', async () => {
    const artifact = await methods.createArtifact({
      title: '  Report  ',
      type: 'document',
      user,
      conversationId: 'conv-1',
    });

    expect(artifact).toMatchObject({
      title: 'Report',
      type: 'document',
      conversationId: 'conv-1',
      currentVersion: 0,
    });
  });

  it('rejects a blank title and an invalid owner', async () => {
    await expect(methods.createArtifact({ title: '  ', type: 'document', user })).rejects.toThrow(
      /title is required/i,
    );
    await expect(
      methods.createArtifact({ title: 'Ok', type: 'document', user: 'bad' }),
    ).rejects.toThrow(/user is required/i);
  });
});

describe('getArtifact / updateArtifact / deleteArtifact', () => {
  it('scopes reads, updates and deletes to the owner', async () => {
    const artifact = await methods.createArtifact({ title: 'A', type: 'code', user });
    const id = artifact._id!.toString();

    expect((await methods.getArtifact(user, id))?.title).toBe('A');
    expect(await methods.getArtifact(otherUser, id)).toBeNull();
    expect(await methods.getArtifact(user, 'bad')).toBeNull();

    const updated = await methods.updateArtifact(user, id, {
      title: 'B',
      metadata: { lang: 'ts' },
    });
    expect(updated).toMatchObject({ title: 'B', metadata: { lang: 'ts' } });

    await expect(methods.updateArtifact(user, id, { title: '  ' })).rejects.toThrow(
      /title is required/i,
    );
    expect(await methods.updateArtifact(otherUser, id, { title: 'X' })).toBeNull();
    expect(await methods.updateArtifact(user, 'bad', { title: 'X' })).toBeNull();

    expect(await methods.deleteArtifact(otherUser, id)).toBe(false);
    expect(await methods.deleteArtifact(user, id)).toBe(true);
    expect(await methods.deleteArtifact(user, 'bad')).toBe(false);
  });

  it('removes the artifact and cascades to its versions', async () => {
    const artifact = await methods.createArtifact({ title: 'A', type: 'code', user });
    await new ArtifactVersion({
      artifactId: artifact._id,
      version: 1,
      content: 'x',
      createdBy: user,
    }).save();

    expect(await methods.deleteArtifact(user, artifact._id!.toString())).toBe(true);
    expect(await Artifact.countDocuments({})).toBe(0);
    expect(await ArtifactVersion.countDocuments({})).toBe(0);
  });
});

describe('listArtifactsForUser / listArtifactsForConversation', () => {
  it('lists newest first and caps the page', async () => {
    await methods.createArtifact({ title: 'first', type: 'code', user });
    await methods.createArtifact({ title: 'second', type: 'code', user });
    await methods.createArtifact({ title: 'other', type: 'code', user: otherUser });

    expect((await methods.listArtifactsForUser(user)).map((a) => a.title)).toEqual([
      'second',
      'first',
    ]);
    expect(await methods.listArtifactsForUser(user, { limit: 1 })).toHaveLength(1);
    expect(
      await methods.listArtifactsForUser(user, { limit: ARTIFACT_LIST_MAX_LIMIT + 10 }),
    ).toHaveLength(2);
    expect(await methods.listArtifactsForUser('bad')).toEqual([]);
  });

  it('lists one conversation in order for its owner only', async () => {
    await methods.createArtifact({ title: 'b', type: 'code', user, conversationId: 'c1' });
    await methods.createArtifact({ title: 'a', type: 'code', user, conversationId: 'c1' });
    await methods.createArtifact({ title: 'x', type: 'code', user, conversationId: 'c2' });
    await methods.createArtifact({ title: 'z', type: 'code', user: otherUser, conversationId: 'c1' });

    expect(
      (await methods.listArtifactsForConversation(user, 'c1')).map((a) => a.title),
    ).toEqual(['b', 'a']);
    expect(await methods.listArtifactsForConversation(user, '')).toEqual([]);
  });
});

describe('tenant isolation', () => {
  it('keeps artifacts invisible across tenants', async () => {
    await runAs(TENANT_A, () => methods.createArtifact({ title: 'alpha', type: 'code', user }));

    expect(await runAs(TENANT_B, () => methods.listArtifactsForUser(user))).toEqual([]);
  });
});
