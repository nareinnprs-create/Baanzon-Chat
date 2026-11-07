import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { INotification } from '..';
import { createNotificationMethods } from './notification';
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
let Notification: mongoose.Model<INotification>;
let methods: ReturnType<typeof createNotificationMethods>;

const user = new mongoose.Types.ObjectId().toString();
const otherUser = new mongoose.Types.ObjectId().toString();

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  Notification = mongoose.models.Notification as mongoose.Model<INotification>;
  methods = createNotificationMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Notification.deleteMany({});
});

describe('createNotification', () => {
  it('creates an unread notification with its payload', async () => {
    const notification = await methods.createNotification({
      userId: user,
      type: 'agent_run',
      title: 'Run finished',
      body: 'all done',
      link: '/runs/1',
      data: { runId: 'run-1' },
    });

    expect(notification).toMatchObject({
      type: 'agent_run',
      title: 'Run finished',
      body: 'all done',
      link: '/runs/1',
      read: false,
      data: { runId: 'run-1' },
    });
    expect(notification.userId.toString()).toBe(user);
  });
});

describe('listNotifications', () => {
  it('orders newest first and filters to unread', async () => {
    const first = await methods.createNotification({ userId: user, type: 'system', title: 'one' });
    await methods.createNotification({ userId: user, type: 'system', title: 'two' });
    await methods.markNotificationRead(user, first._id!.toString());

    const all = await methods.listNotifications(user);
    expect(all).toHaveLength(2);

    const unread = await methods.listNotifications(user, { unreadOnly: true });
    expect(unread.map((item) => item.title)).toEqual(['two']);
  });

  it('caps the feed by limit and ignores invalid users', async () => {
    await methods.createNotification({ userId: user, type: 'system', title: 'one' });
    await methods.createNotification({ userId: user, type: 'system', title: 'two' });

    expect(await methods.listNotifications(user, { limit: 1 })).toHaveLength(1);
    expect(await methods.listNotifications('bad')).toEqual([]);
  });
});

describe('countUnreadNotifications', () => {
  it('counts only unread notifications for the user', async () => {
    const first = await methods.createNotification({ userId: user, type: 'system', title: 'one' });
    await methods.createNotification({ userId: user, type: 'system', title: 'two' });
    await methods.createNotification({ userId: otherUser, type: 'system', title: 'theirs' });
    await methods.markNotificationRead(user, first._id!.toString());

    expect(await methods.countUnreadNotifications(user)).toBe(1);
    expect(await methods.countUnreadNotifications('bad')).toBe(0);
  });
});

describe('markNotificationRead', () => {
  it('marks a notification read only for its owner', async () => {
    const notification = await methods.createNotification({
      userId: user,
      type: 'system',
      title: 'one',
    });

    expect(await methods.markNotificationRead(otherUser, notification._id!.toString())).toBeNull();

    const read = await methods.markNotificationRead(user, notification._id!.toString());
    expect(read).toMatchObject({ read: true });
    expect(read?.readAt).toBeInstanceOf(Date);
    expect(await methods.markNotificationRead(user, 'bad')).toBeNull();
  });
});

describe('markAllNotificationsRead', () => {
  it('marks every unread notification read and reports the count', async () => {
    await methods.createNotification({ userId: user, type: 'system', title: 'one' });
    await methods.createNotification({ userId: user, type: 'system', title: 'two' });
    await methods.createNotification({ userId: otherUser, type: 'system', title: 'theirs' });

    expect(await methods.markAllNotificationsRead(user)).toBe(2);
    expect(await methods.countUnreadNotifications(user)).toBe(0);
    expect(await methods.countUnreadNotifications(otherUser)).toBe(1);
    expect(await methods.markAllNotificationsRead('bad')).toBe(0);
  });
});

describe('deleteNotification', () => {
  it('deletes only the owner’s notification', async () => {
    const notification = await methods.createNotification({
      userId: user,
      type: 'system',
      title: 'one',
    });
    const id = notification._id!.toString();

    expect(await methods.deleteNotification(otherUser, id)).toBe(false);
    expect(await methods.deleteNotification(user, id)).toBe(true);
    expect(await methods.deleteNotification(user, id)).toBe(false);
    expect(await methods.deleteNotification(user, 'bad')).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('keeps notifications invisible across tenants', async () => {
    await runAs(TENANT_A, () =>
      methods.createNotification({ userId: user, type: 'system', title: 'alpha' }),
    );

    expect(await runAs(TENANT_B, () => methods.listNotifications(user))).toEqual([]);
    expect(await runAs(TENANT_B, () => methods.countUnreadNotifications(user))).toBe(0);
  });
});
