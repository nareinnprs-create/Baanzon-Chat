import { EventEmitter } from 'events';
import type { TNotification } from 'librechat-data-provider';
import type { Response } from 'express';
import { createNotificationStreamHub, NOTIFICATION_STREAM_HEARTBEAT_MS } from './stream';

interface MockResponse {
  res: Response;
  statusCode: number;
  headers: Record<string, string>;
  chunks: string[];
  body: () => string;
  emitter: EventEmitter;
}

function mockResponse(): MockResponse {
  const emitter = new EventEmitter();
  const chunks: string[] = [];
  let statusCode = 0;
  let headers: Record<string, string> = {};
  const res = {
    writeHead(code: number, value: Record<string, string>) {
      statusCode = code;
      headers = value;
      return res;
    },
    flushHeaders() {},
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end() {
      emitter.emit('close');
    },
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
  };
  return {
    res: res as unknown as Response,
    get statusCode() {
      return statusCode;
    },
    get headers() {
      return headers;
    },
    chunks,
    body: () => chunks.join(''),
    emitter,
  } as MockResponse;
}

const notification: TNotification = {
  id: 'n-1',
  type: 'agent_run',
  title: 'Run finished',
  read: false,
  readAt: null,
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('createNotificationStreamHub', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('opens an SSE stream with a ready frame and tracks the connection', () => {
    const hub = createNotificationStreamHub();
    const connection = mockResponse();
    hub.subscribe('user-1', connection.res, { unreadCount: 3 });

    expect(connection.statusCode).toBe(200);
    expect(connection.headers['Content-Type']).toBe('text/event-stream; charset=utf-8');
    expect(connection.headers['X-Accel-Buffering']).toBe('no');
    expect(connection.body()).toContain('event: ready');
    expect(connection.body()).toContain('"unreadCount":3');
    expect(hub.connectionCount('user-1')).toBe(1);
    expect(hub.connectionCount()).toBe(1);

    hub.close();
  });

  it('publishes only to the matching user', () => {
    const hub = createNotificationStreamHub();
    const mine = mockResponse();
    const other = mockResponse();
    hub.subscribe('user-1', mine.res, { unreadCount: 0 });
    hub.subscribe('user-2', other.res, { unreadCount: 0 });

    hub.publish('user-1', notification, 5);

    expect(mine.body()).toContain('event: notification');
    expect(mine.body()).toContain('"id":"n-1"');
    expect(mine.body()).toContain('"unreadCount":5');
    expect(other.body()).not.toContain('event: notification');

    hub.close();
  });

  it('drops a connection when the client disconnects', () => {
    const hub = createNotificationStreamHub();
    const connection = mockResponse();
    hub.subscribe('user-1', connection.res, { unreadCount: 0 });
    expect(hub.connectionCount('user-1')).toBe(1);

    connection.emitter.emit('close');

    expect(hub.connectionCount('user-1')).toBe(0);
    hub.publish('user-1', notification);
    expect(connection.body()).not.toContain('event: notification');
  });

  it('emits heartbeats to keep the stream alive', () => {
    jest.useFakeTimers();
    const hub = createNotificationStreamHub();
    const connection = mockResponse();
    hub.subscribe('user-1', connection.res, { unreadCount: 0 });

    jest.advanceTimersByTime(NOTIFICATION_STREAM_HEARTBEAT_MS);

    expect(connection.body()).toContain(': heartbeat');
    hub.close();
  });

  it('ends every connection on close', () => {
    const hub = createNotificationStreamHub();
    const connection = mockResponse();
    hub.subscribe('user-1', connection.res, { unreadCount: 0 });

    hub.close();

    expect(connection.body()).toContain('event: ready');
    expect(hub.connectionCount()).toBe(0);
  });
});
