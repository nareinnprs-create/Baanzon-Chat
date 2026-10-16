import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { ISource } from '..';
import { createSourceMethods, SOURCE_LIST_MAX_LIMIT } from './source';
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
let Source: mongoose.Model<ISource>;
let methods: ReturnType<typeof createSourceMethods>;

const user = new mongoose.Types.ObjectId().toString();
const otherUser = new mongoose.Types.ObjectId().toString();

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  Source = mongoose.models.Source as mongoose.Model<ISource>;
  methods = createSourceMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Source.deleteMany({});
});

describe('createSource', () => {
  it('stores a trimmed source with provenance', async () => {
    const source = await methods.createSource({
      title: '  RFC 7519  ',
      type: 'web',
      user,
      url: 'https://example.test/rfc',
      conversationId: 'conv-1',
      metadata: { domain: 'example.test' },
    });

    expect(source).toMatchObject({
      title: 'RFC 7519',
      type: 'web',
      url: 'https://example.test/rfc',
      conversationId: 'conv-1',
      metadata: { domain: 'example.test' },
    });
    expect(source.user.toString()).toBe(user);
  });

  it('rejects a blank title and an invalid owner', async () => {
    await expect(methods.createSource({ title: '  ', type: 'web', user })).rejects.toThrow(
      /title is required/i,
    );
    await expect(
      methods.createSource({ title: 'Ok', type: 'web', user: 'bad' }),
    ).rejects.toThrow(/user is required/i);
  });
});

describe('getSource / deleteSource', () => {
  it('scopes reads and deletes to the owner', async () => {
    const source = await methods.createSource({ title: 'S', type: 'file', user });
    const id = source._id!.toString();

    expect((await methods.getSource(user, id))?.title).toBe('S');
    expect(await methods.getSource(otherUser, id)).toBeNull();
    expect(await methods.getSource(user, 'bad')).toBeNull();

    expect(await methods.deleteSource(otherUser, id)).toBe(false);
    expect(await methods.deleteSource(user, id)).toBe(true);
    expect(await methods.deleteSource(user, 'bad')).toBe(false);
  });
});

describe('listSourcesForUser / listSourcesForConversation', () => {
  it('lists newest first and caps the page', async () => {
    await methods.createSource({ title: 'first', type: 'web', user });
    await methods.createSource({ title: 'second', type: 'web', user });
    await methods.createSource({ title: 'other', type: 'web', user: otherUser });

    const listed = await methods.listSourcesForUser(user);
    expect(listed.map((s) => s.title)).toEqual(['second', 'first']);
    expect(await methods.listSourcesForUser(user, { limit: 1 })).toHaveLength(1);
    expect(
      await methods.listSourcesForUser(user, { limit: SOURCE_LIST_MAX_LIMIT + 10 }),
    ).toHaveLength(2);
    expect(await methods.listSourcesForUser('bad')).toEqual([]);
  });

  it('lists one conversation in order for its owner only', async () => {
    await methods.createSource({ title: 'b', type: 'web', user, conversationId: 'c1' });
    await methods.createSource({ title: 'a', type: 'web', user, conversationId: 'c1' });
    await methods.createSource({ title: 'x', type: 'web', user, conversationId: 'c2' });
    await methods.createSource({ title: 'z', type: 'web', user: otherUser, conversationId: 'c1' });

    expect(
      (await methods.listSourcesForConversation(user, 'c1')).map((s) => s.title),
    ).toEqual(['b', 'a']);
    expect(await methods.listSourcesForConversation(user, '')).toEqual([]);
  });
});

describe('tenant isolation', () => {
  it('keeps sources invisible across tenants', async () => {
    await runAs(TENANT_A, () => methods.createSource({ title: 'alpha', type: 'web', user }));

    expect(await runAs(TENANT_B, () => methods.listSourcesForUser(user))).toEqual([]);
  });
});
