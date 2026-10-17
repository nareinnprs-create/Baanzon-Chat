import type { NotificationDataSource, NotificationRecord } from './types';
import {
  createNotificationsService,
  NOTIFICATIONS_DEFAULT_PAGE_SIZE,
  NOTIFICATIONS_MAX_PAGE_SIZE,
  serializeNotification,
} from './service';

function record(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    _id: 'notif-1',
    userId: 'user-1',
    type: 'system',
    title: 'Hello',
    read: false,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

interface MockDataSource extends NotificationDataSource {
  createNotification: jest.Mock;
  listNotifications: jest.Mock;
  countUnreadNotifications: jest.Mock;
  markNotificationRead: jest.Mock;
  markAllNotificationsRead: jest.Mock;
  deleteNotification: jest.Mock;
}

function makeDataSource(overrides: Partial<MockDataSource> = {}): MockDataSource {
  return {
    createNotification: jest.fn(),
    listNotifications: jest.fn().mockResolvedValue([]),
    countUnreadNotifications: jest.fn().mockResolvedValue(0),
    markNotificationRead: jest.fn().mockResolvedValue(null),
    markAllNotificationsRead: jest.fn().mockResolvedValue(0),
    deleteNotification: jest.fn().mockResolvedValue(false),
    ...overrides,
  } as MockDataSource;
}

describe('serializeNotification', () => {
  it('maps a storage row to the Mongoose-free wire shape', () => {
    expect(serializeNotification(record({ body: 'b', link: '/c/x' }))).toEqual({
      id: 'notif-1',
      type: 'system',
      title: 'Hello',
      body: 'b',
      link: '/c/x',
      read: false,
      readAt: null,
      data: undefined,
      createdAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('stringifies ObjectId-like ids and normalizes invalid dates to null', () => {
    const serialized = serializeNotification(
      record({ _id: { toString: () => 'abc123' }, readAt: 'not-a-date' }),
    );
    expect(serialized.id).toBe('abc123');
    expect(serialized.readAt).toBeNull();
  });
});

describe('createNotificationsService', () => {
  it('over-fetches one row to compute hasMore and slices the page', async () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      record({ _id: `n-${i}`, createdAt: new Date(2024, 0, i + 1) }),
    );
    const dataSource = makeDataSource({
      listNotifications: jest.fn().mockResolvedValue(rows),
      countUnreadNotifications: jest.fn().mockResolvedValue(7),
    });
    const service = createNotificationsService({ notifications: dataSource });

    const page = await service.list('user-1', { limit: 2, page: 1 });

    expect(dataSource.listNotifications).toHaveBeenCalledWith('user-1', {
      unreadOnly: undefined,
      limit: 3,
    });
    expect(page.notifications.map((n) => n.id)).toEqual(['n-0', 'n-1']);
    expect(page.unreadCount).toBe(7);
    expect(page.hasMore).toBe(true);
  });

  it('reports no more rows on the final page', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => record({ _id: `n-${i}` }));
    const dataSource = makeDataSource({
      listNotifications: jest.fn().mockResolvedValue(rows),
    });
    const service = createNotificationsService({ notifications: dataSource });

    const page = await service.list('user-1', { limit: 2, page: 2 });
    expect(page.notifications.map((n) => n.id)).toEqual(['n-2', 'n-3']);
    expect(page.hasMore).toBe(false);
    expect(dataSource.listNotifications).toHaveBeenCalledWith('user-1', {
      unreadOnly: undefined,
      limit: 5,
    });
  });

  it('clamps page size to the data-schemas maximum and defaults invalid input', async () => {
    const dataSource = makeDataSource();
    const service = createNotificationsService({ notifications: dataSource });

    await service.list('user-1', { limit: 5000 });
    expect(dataSource.listNotifications).toHaveBeenLastCalledWith('user-1', {
      unreadOnly: undefined,
      limit: NOTIFICATIONS_MAX_PAGE_SIZE,
    });

    await service.list('user-1', { limit: -1, page: 0 });
    expect(dataSource.listNotifications).toHaveBeenLastCalledWith('user-1', {
      unreadOnly: undefined,
      limit: NOTIFICATIONS_DEFAULT_PAGE_SIZE + 1,
    });
  });

  it('creates, marks, deletes and counts through the injected data source', async () => {
    const created = record({ _id: 'new', title: 'Created' });
    const dataSource = makeDataSource({
      createNotification: jest.fn().mockResolvedValue(created),
      markNotificationRead: jest
        .fn()
        .mockResolvedValueOnce(record({ _id: 'n-1', read: true }))
        .mockResolvedValueOnce(null),
      markAllNotificationsRead: jest.fn().mockResolvedValue(4),
      deleteNotification: jest.fn().mockResolvedValue(true),
      countUnreadNotifications: jest.fn().mockResolvedValue(9),
    });
    const service = createNotificationsService({ notifications: dataSource });

    expect((await service.create('user-1', { type: 'agent_run', title: 'Created' })).id).toBe(
      'new',
    );
    expect(dataSource.createNotification).toHaveBeenCalledWith({
      userId: 'user-1',
      type: 'agent_run',
      title: 'Created',
      body: undefined,
      link: undefined,
      data: undefined,
    });

    expect((await service.markRead('user-1', 'n-1'))?.read).toBe(true);
    expect(await service.markRead('user-1', 'missing')).toBeNull();
    expect(await service.markAllRead('user-1')).toBe(4);
    expect(await service.remove('user-1', 'n-1')).toBe(true);
    expect(await service.unreadCount('user-1')).toBe(9);
  });
});
