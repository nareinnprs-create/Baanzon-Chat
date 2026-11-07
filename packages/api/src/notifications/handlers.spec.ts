import type { AppConfig } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { NotificationsService } from './service';
import type { NotificationStreamHub } from './stream';
import type { ServerRequest } from '~/types/http';
import { createNotificationsHandlers } from './handlers';

interface MockResponse {
  res: Response;
  statusCode: number;
  body?: Record<string, unknown>;
  headersSent: boolean;
  connected: boolean;
}

function mockResponse(): MockResponse {
  let statusCode = 200;
  let body: Record<string, unknown> | undefined;
  let headersSent = false;
  const response: MockResponse = {
    statusCode,
    body,
    headersSent,
    connected: false,
    res: undefined as unknown as Response,
  };
  const res = {
    status(code: number) {
      statusCode = code;
      response.statusCode = code;
      return res;
    },
    json(value: Record<string, unknown>) {
      body = value;
      response.body = value;
      response.headersSent = true;
      return res;
    },
    setHeader() {
      return res;
    },
    writeHead() {
      headersSent = true;
      response.headersSent = true;
      return res;
    },
    flushHeaders() {},
    write() {
      return true;
    },
    end() {
      return res;
    },
    on() {
      return res;
    },
  };
  response.res = res as unknown as Response;
  return response;
}

function request(overrides: Record<string, unknown> = {}): ServerRequest {
  return {
    user: { id: 'user-1', _id: 'user-1', role: 'USER' },
    query: {},
    params: {},
    body: {},
    config: { config: {} } as unknown as AppConfig,
    ...overrides,
  } as unknown as ServerRequest;
}

function service(): jest.Mocked<NotificationsService> {
  return {
    list: jest.fn().mockResolvedValue({ notifications: [], unreadCount: 0, hasMore: false }),
    create: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn().mockResolvedValue(0),
    remove: jest.fn().mockResolvedValue(false),
    unreadCount: jest.fn().mockResolvedValue(0),
  } as unknown as jest.Mocked<NotificationsService>;
}

function hub(): jest.Mocked<NotificationStreamHub> {
  return {
    subscribe: jest.fn(),
    publish: jest.fn(),
    connectionCount: jest.fn().mockReturnValue(0),
    close: jest.fn(),
  } as unknown as jest.Mocked<NotificationStreamHub>;
}

function withNotifications(config: Record<string, unknown>): AppConfig {
  return { config: { notifications: config } } as unknown as AppConfig;
}

describe('createNotificationsHandlers', () => {
  it('requires authentication on every route', async () => {
    const handlers = createNotificationsHandlers({ service: service(), hub: hub() });
    const response = mockResponse();

    await handlers.listNotifications(request({ user: undefined }), response.res);

    expect(response.statusCode).toBe(401);
  });

  it('returns 404 when notifications are disabled', async () => {
    const handlers = createNotificationsHandlers({ service: service(), hub: hub() });
    const response = mockResponse();

    await handlers.listNotifications(
      request({ config: withNotifications({ enabled: false }) }),
      response.res,
    );

    expect(response.statusCode).toBe(404);
  });

  it('lists notifications with resolved settings', async () => {
    const list = jest.fn().mockResolvedValue({
      notifications: [{ id: 'n-1' }],
      unreadCount: 2,
      hasMore: true,
    });
    const handlers = createNotificationsHandlers({
      service: { ...service(), list } as unknown as NotificationsService,
      hub: hub(),
    });
    const response = mockResponse();

    await handlers.listNotifications(
      request({
        config: withNotifications({ pollingIntervalMs: 5000 }),
        query: { limit: '10', page: '2', unreadOnly: 'true' },
      }),
      response.res,
    );

    expect(list).toHaveBeenCalledWith('user-1', { limit: 10, page: 2, unreadOnly: true });
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      unreadCount: 2,
      hasMore: true,
      settings: { enabled: true, realtime: true, pollingIntervalMs: 5000 },
    });
  });

  it('returns the unread count', async () => {
    const handlers = createNotificationsHandlers({
      service: {
        ...service(),
        unreadCount: jest.fn().mockResolvedValue(6),
      } as NotificationsService,
      hub: hub(),
    });
    const response = mockResponse();

    await handlers.getUnreadCount(request(), response.res);

    expect(response.body).toMatchObject({ count: 6 });
  });

  it('marks a single notification read and 404s when missing', async () => {
    const markRead = jest.fn().mockResolvedValue({ id: 'n-1', read: true });
    const handlers = createNotificationsHandlers({
      service: { ...service(), markRead } as unknown as NotificationsService,
      hub: hub(),
    });

    const ok = mockResponse();
    await handlers.markRead(request({ params: { id: 'n-1' } }), ok.res);
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toEqual({ notification: { id: 'n-1', read: true } });

    markRead.mockResolvedValueOnce(null);
    const missing = mockResponse();
    await handlers.markRead(request({ params: { id: 'gone' } }), missing.res);
    expect(missing.statusCode).toBe(404);
  });

  it('marks all read and deletes a notification', async () => {
    const handlers = createNotificationsHandlers({
      service: {
        ...service(),
        markAllRead: jest.fn().mockResolvedValue(3),
        remove: jest.fn().mockResolvedValue(true),
      } as unknown as NotificationsService,
      hub: hub(),
    });

    const allRead = mockResponse();
    await handlers.markAllRead(request(), allRead.res);
    expect(allRead.body).toEqual({ modified: 3 });

    const deleted = mockResponse();
    await handlers.deleteNotification(request({ params: { id: 'n-1' } }), deleted.res);
    expect(deleted.statusCode).toBe(200);
    expect(deleted.body).toEqual({ deleted: true });
  });

  it('validates the create payload and pushes the new notification', async () => {
    const created = {
      id: 'n-9',
      type: 'system',
      title: 'Hi',
      read: false,
      readAt: null,
      createdAt: 'x',
    };
    const create = jest.fn().mockResolvedValue(created);
    const publishHub = hub();
    const handlers = createNotificationsHandlers({
      service: {
        ...service(),
        create,
        unreadCount: jest.fn().mockResolvedValue(1),
      } as unknown as NotificationsService,
      hub: publishHub,
    });

    const invalid = mockResponse();
    await handlers.createNotification(request({ body: { type: 'nope' } }), invalid.res);
    expect(invalid.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();

    const ok = mockResponse();
    await handlers.createNotification(request({ body: { type: 'system', title: 'Hi' } }), ok.res);
    expect(ok.statusCode).toBe(201);
    expect(publishHub.publish).toHaveBeenCalledWith('user-1', created, 1);
  });

  it('opens the stream only when realtime is enabled', async () => {
    const streamHub = hub();
    const handlers = createNotificationsHandlers({
      service: {
        ...service(),
        unreadCount: jest.fn().mockResolvedValue(4),
      } as NotificationsService,
      hub: streamHub,
    });

    const disabled = mockResponse();
    await handlers.stream(
      request({ config: withNotifications({ realtime: false }) }),
      disabled.res,
    );
    expect(disabled.statusCode).toBe(404);
    expect(streamHub.subscribe).not.toHaveBeenCalled();

    const enabled = mockResponse();
    await handlers.stream(request(), enabled.res);
    expect(streamHub.subscribe).toHaveBeenCalledWith('user-1', enabled.res, { unreadCount: 4 });
  });
});
