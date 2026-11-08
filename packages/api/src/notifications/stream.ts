import type { TNotification } from 'librechat-data-provider';
import type { Response } from 'express';

const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export const NOTIFICATION_STREAM_HEARTBEAT_MS = 25000;

export interface NotificationStreamInitial {
  unreadCount: number;
}

export interface NotificationStreamPayload {
  notification: TNotification;
  unreadCount?: number;
}

export interface NotificationStreamHub {
  subscribe(userId: string, res: Response, initial: NotificationStreamInitial): void;
  publish(userId: string, notification: TNotification, unreadCount?: number): void;
  /** Open connection count, for the given user or across all users. */
  connectionCount(userId?: string): number;
  close(): void;
}

interface Connection {
  res: Response;
  heartbeat: NodeJS.Timeout;
}

function writeEvent(res: Response, event: string, data: unknown, id?: string): void {
  if (id != null) {
    res.write(`id: ${id}\n`);
  }
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * In-process fan-out for background-run notifications. Deliberately not a
 * module singleton: the caller creates one hub and injects it, so horizontal
 * scaling can swap in a pub/sub-backed implementation without a new branch.
 */
export function createNotificationStreamHub(): NotificationStreamHub {
  const connections = new Map<string, Set<Connection>>();

  function remove(userId: string, connection: Connection): void {
    clearInterval(connection.heartbeat);
    const set = connections.get(userId);
    if (set == null) {
      return;
    }
    set.delete(connection);
    if (set.size === 0) {
      connections.delete(userId);
    }
  }

  function subscribe(userId: string, res: Response, initial: NotificationStreamInitial): void {
    res.writeHead(200, SSE_HEADERS);
    res.flushHeaders?.();
    writeEvent(res, 'ready', initial);

    const connection: Connection = {
      res,
      heartbeat: setInterval(() => {
        try {
          res.write(': heartbeat\n\n');
        } catch {
          remove(userId, connection);
        }
      }, NOTIFICATION_STREAM_HEARTBEAT_MS),
    };
    connection.heartbeat.unref?.();

    let set = connections.get(userId);
    if (set == null) {
      set = new Set<Connection>();
      connections.set(userId, set);
    }
    set.add(connection);

    res.on('close', () => remove(userId, connection));
    res.on('error', () => remove(userId, connection));
  }

  function publish(userId: string, notification: TNotification, unreadCount?: number): void {
    const set = connections.get(userId);
    if (set == null || set.size === 0) {
      return;
    }
    const payload: NotificationStreamPayload = { notification };
    if (unreadCount != null) {
      payload.unreadCount = unreadCount;
    }
    for (const connection of set) {
      try {
        writeEvent(connection.res, 'notification', payload, notification.id);
      } catch {
        remove(userId, connection);
      }
    }
  }

  function connectionCount(userId?: string): number {
    if (userId == null) {
      return connections.size;
    }
    return connections.get(userId)?.size ?? 0;
  }

  function close(): void {
    for (const [userId, set] of connections) {
      for (const connection of set) {
        clearInterval(connection.heartbeat);
        try {
          connection.res.end();
        } catch {
          /* the socket is already gone */
        }
      }
      connections.delete(userId);
    }
  }

  return { subscribe, publish, connectionCount, close };
}
