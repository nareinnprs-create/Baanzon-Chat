import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IMessagePart } from '..';
import { createMessagePartMethods } from './messagePart';
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
let MessagePart: mongoose.Model<IMessagePart>;
let methods: ReturnType<typeof createMessagePartMethods>;

const user = new mongoose.Types.ObjectId().toString();
const otherUser = new mongoose.Types.ObjectId().toString();
const conversationId = 'conv-1';

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  MessagePart = mongoose.models.MessagePart as mongoose.Model<IMessagePart>;
  methods = createMessagePartMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await MessagePart.deleteMany({});
});

describe('addMessagePart', () => {
  it('stores a typed part with content', async () => {
    const part = await methods.addMessagePart({
      messageId: 'msg-1',
      conversationId,
      user,
      index: 0,
      type: 'text',
      text: 'hello',
    });

    expect(part).toMatchObject({ messageId: 'msg-1', index: 0, type: 'text', text: 'hello' });
  });

  it('replaces the part at an occupied index instead of duplicating', async () => {
    await methods.addMessagePart({
      messageId: 'msg-1',
      conversationId,
      user,
      index: 0,
      type: 'text',
      text: 'first',
    });
    const replaced = await methods.addMessagePart({
      messageId: 'msg-1',
      conversationId,
      user,
      index: 0,
      type: 'reasoning',
      text: 'second',
    });

    expect(replaced).toMatchObject({ type: 'reasoning', text: 'second' });
    expect(await MessagePart.countDocuments({ messageId: 'msg-1' })).toBe(1);
  });
});

describe('listMessageParts', () => {
  it('returns a user’s parts ordered by index', async () => {
    await methods.addMessagePart({
      messageId: 'msg-1',
      conversationId,
      user,
      index: 2,
      type: 'text',
      text: 'second',
    });
    await methods.addMessagePart({
      messageId: 'msg-1',
      conversationId,
      user,
      index: 1,
      type: 'text',
      text: 'first',
    });

    const parts = await methods.listMessageParts(user, 'msg-1');
    expect(parts.map((part) => part.text)).toEqual(['first', 'second']);
  });

  it('does not return another user’s parts', async () => {
    await methods.addMessagePart({
      messageId: 'msg-1',
      conversationId,
      user: otherUser,
      index: 0,
      type: 'text',
      text: 'theirs',
    });

    expect(await methods.listMessageParts(user, 'msg-1')).toEqual([]);
  });
});

describe('listConversationParts', () => {
  it('orders by message then index', async () => {
    await methods.addMessagePart({
      messageId: 'msg-b',
      conversationId,
      user,
      index: 0,
      type: 'text',
      text: 'b0',
    });
    await methods.addMessagePart({
      messageId: 'msg-a',
      conversationId,
      user,
      index: 1,
      type: 'text',
      text: 'a1',
    });
    await methods.addMessagePart({
      messageId: 'msg-a',
      conversationId,
      user,
      index: 0,
      type: 'text',
      text: 'a0',
    });

    const parts = await methods.listConversationParts(user, conversationId);
    expect(parts.map((part) => part.text)).toEqual(['a0', 'a1', 'b0']);
  });
});

describe('updateMessagePart', () => {
  it('updates text and content only for the owner', async () => {
    const part = await methods.addMessagePart({
      messageId: 'msg-1',
      conversationId,
      user,
      index: 0,
      type: 'tool_result',
      content: { ok: true },
    });

    const updated = await methods.updateMessagePart(user, part._id!.toString(), {
      text: 'done',
      content: { ok: false },
    });
    expect(updated).toMatchObject({ text: 'done', content: { ok: false } });

    const hijack = await methods.updateMessagePart(otherUser, part._id!.toString(), {
      text: 'stolen',
    });
    expect(hijack).toBeNull();
    expect(await methods.updateMessagePart(user, 'bad', { text: 'x' })).toBeNull();
  });
});

describe('deleteMessagePart', () => {
  it('deletes only the owner’s part', async () => {
    const part = await methods.addMessagePart({
      messageId: 'msg-1',
      conversationId,
      user,
      index: 0,
      type: 'text',
      text: 'mine',
    });

    expect(await methods.deleteMessagePart(otherUser, part._id!.toString())).toBe(false);
    expect(await methods.deleteMessagePart(user, part._id!.toString())).toBe(true);
    expect(await methods.deleteMessagePart(user, part._id!.toString())).toBe(false);
    expect(await methods.deleteMessagePart(user, 'bad')).toBe(false);
  });
});

describe('deleteMessagePartsForMessage', () => {
  it('removes every part of a message and reports the count', async () => {
    await methods.addMessagePart({
      messageId: 'msg-1',
      conversationId,
      user,
      index: 0,
      type: 'text',
    });
    await methods.addMessagePart({
      messageId: 'msg-1',
      conversationId,
      user,
      index: 1,
      type: 'text',
    });
    await methods.addMessagePart({
      messageId: 'msg-2',
      conversationId,
      user,
      index: 0,
      type: 'text',
    });

    expect(await methods.deleteMessagePartsForMessage('msg-1')).toBe(2);
    expect(await MessagePart.countDocuments({ messageId: 'msg-1' })).toBe(0);
    expect(await methods.deleteMessagePartsForMessage('msg-1')).toBe(0);
  });
});

describe('tenant isolation', () => {
  it('keeps message parts invisible across tenants', async () => {
    await runAs(TENANT_A, () =>
      methods.addMessagePart({
        messageId: 'msg-1',
        conversationId,
        user,
        index: 0,
        type: 'text',
        text: 'alpha',
      }),
    );

    expect(await runAs(TENANT_B, () => methods.listMessageParts(user, 'msg-1'))).toEqual([]);
  });
});
