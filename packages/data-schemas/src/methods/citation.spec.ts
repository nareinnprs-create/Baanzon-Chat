import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { ICitation } from '..';
import { tenantStorage } from '../config/tenantContext';
import { createCitationMethods } from './citation';
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
let Citation: mongoose.Model<ICitation>;
let methods: ReturnType<typeof createCitationMethods>;

const user = new mongoose.Types.ObjectId().toString();
const otherUser = new mongoose.Types.ObjectId().toString();
const sourceId = new mongoose.Types.ObjectId().toString();
const otherSourceId = new mongoose.Types.ObjectId().toString();
const conversationId = 'conv-1';

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  Citation = mongoose.models.Citation as mongoose.Model<ICitation>;
  methods = createCitationMethods(mongoose);
  await Citation.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Citation.deleteMany({});
});

describe('addCitation', () => {
  it('stores a citation with its span metadata', async () => {
    const citation = await methods.addCitation({
      sourceId,
      messageId: 'msg-1',
      conversationId,
      user,
      index: 0,
      quote: 'quoted text',
      score: 0.9,
    });

    expect(citation).toMatchObject({ messageId: 'msg-1', index: 0, quote: 'quoted text', score: 0.9 });
    expect(citation.sourceId.toString()).toBe(sourceId);
  });

  it('replaces the citation at an occupied index instead of duplicating', async () => {
    await methods.addCitation({ sourceId, messageId: 'msg-1', conversationId, user, index: 0 });
    const replaced = await methods.addCitation({
      sourceId: otherSourceId,
      messageId: 'msg-1',
      conversationId,
      user,
      index: 0,
    });

    expect(replaced.sourceId.toString()).toBe(otherSourceId);
    expect(await Citation.countDocuments({ messageId: 'msg-1' })).toBe(1);
  });
});

describe('listCitationsForMessage / listCitationsForConversation', () => {
  it('orders by index and scopes to the owner', async () => {
    await methods.addCitation({ sourceId, messageId: 'msg-1', conversationId, user, index: 2 });
    await methods.addCitation({ sourceId, messageId: 'msg-1', conversationId, user, index: 1 });
    await methods.addCitation({
      sourceId,
      messageId: 'msg-1',
      conversationId,
      user: otherUser,
      index: 0,
    });

    expect((await methods.listCitationsForMessage(user, 'msg-1')).map((c) => c.index)).toEqual([1, 2]);
    expect(await methods.listCitationsForMessage(otherUser, 'msg-1')).toHaveLength(1);
    expect(await methods.listCitationsForMessage('bad', 'msg-1')).toEqual([]);

    expect(await methods.listCitationsForConversation(user, conversationId)).toHaveLength(2);
    expect(await methods.listCitationsForConversation(user, '')).toEqual([]);
  });
});

describe('deleteCitationsForMessage / deleteCitation', () => {
  it('bulk-deletes by message and reports the count', async () => {
    await methods.addCitation({ sourceId, messageId: 'msg-1', conversationId, user, index: 0 });
    await methods.addCitation({ sourceId, messageId: 'msg-1', conversationId, user, index: 1 });
    await methods.addCitation({ sourceId, messageId: 'msg-2', conversationId, user, index: 0 });

    expect(await methods.deleteCitationsForMessage('msg-1')).toBe(2);
    expect(await methods.deleteCitationsForMessage('msg-1')).toBe(0);
  });

  it('deletes a single citation only for its owner', async () => {
    const citation = await methods.addCitation({
      sourceId,
      messageId: 'msg-1',
      conversationId,
      user,
      index: 0,
    });
    const id = citation._id!.toString();

    expect(await methods.deleteCitation(otherUser, id)).toBe(false);
    expect(await methods.deleteCitation(user, id)).toBe(true);
    expect(await methods.deleteCitation(user, 'bad')).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('keeps citations invisible across tenants', async () => {
    await runAs(TENANT_A, () =>
      methods.addCitation({ sourceId, messageId: 'msg-1', conversationId, user, index: 0 }),
    );

    expect(await runAs(TENANT_B, () => methods.listCitationsForMessage(user, 'msg-1'))).toEqual([]);
  });
});
