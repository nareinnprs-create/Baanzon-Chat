import { logger } from '@librechat/data-schemas';
import type { TNotification, TNotificationCreateRequest } from 'librechat-data-provider';
import type { NotificationDataSource, NotificationRecord } from './types';

/** Default page size when the caller does not ask for one. */
export const NOTIFICATIONS_DEFAULT_PAGE_SIZE = 20;
/** Hard cap mirroring `packages/data-schemas` `NOTIFICATION_LIST_MAX_LIMIT`. */
export const NOTIFICATIONS_MAX_PAGE_SIZE = 200;

export interface ListNotificationsParams {
  limit?: number;
  page?: number;
  unreadOnly?: boolean;
}

export interface NotificationsPage {
  notifications: TNotification[];
  unreadCount: number;
  hasMore: boolean;
}

export interface NotificationsService {
  list(userId: string, params?: ListNotificationsParams): Promise<NotificationsPage>;
  create(userId: string, input: TNotificationCreateRequest): Promise<TNotification>;
  markRead(userId: string, id: string): Promise<TNotification | null>;
  markAllRead(userId: string): Promise<number>;
  remove(userId: string, id: string): Promise<boolean>;
  unreadCount(userId: string): Promise<number>;
}

export interface CreateNotificationsServiceDeps {
  notifications: NotificationDataSource;
  /**
   * Optional fan-out hook fired once per created notification (the single seam
   * shared by the REST handler and background producers). The hook owns its
   * errors: `create` never awaits or surfaces a rejection from it.
   */
  onCreated?: (userId: string, notification: TNotification) => void;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizePageSize(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    return NOTIFICATIONS_DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(limit), NOTIFICATIONS_MAX_PAGE_SIZE);
}

function normalizePage(page: number | undefined): number {
  if (page == null || !Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.floor(page);
}

/** Serialize a storage row into the Mongoose-free wire shape the client consumes. */
export function serializeNotification(record: NotificationRecord): TNotification {
  return {
    id: record._id == null ? '' : String(record._id),
    type: record.type as TNotification['type'],
    title: record.title,
    body: record.body,
    link: record.link,
    read: Boolean(record.read),
    readAt: toIsoString(record.readAt),
    data: record.data,
    createdAt: toIsoString(record.createdAt) ?? new Date(0).toISOString(),
  };
}

export function createNotificationsService(
  deps: CreateNotificationsServiceDeps,
): NotificationsService {
  const { notifications } = deps;

  async function list(
    userId: string,
    params?: ListNotificationsParams,
  ): Promise<NotificationsPage> {
    const page = normalizePage(params?.page);
    const pageSize = normalizePageSize(params?.limit);
    const offset = (page - 1) * pageSize;
    /**
     * Over-fetch by one row to detect `hasMore`. The page size is capped but
     * paging depth is not: offset/skip reaches any row in the feed.
     */
    const [rows, unreadCount] = await Promise.all([
      notifications.listNotifications(userId, {
        unreadOnly: params?.unreadOnly,
        limit: pageSize + 1,
        skip: offset,
      }),
      notifications.countUnreadNotifications(userId),
    ]);
    return {
      notifications: rows.slice(offset, offset + pageSize).map(serializeNotification),
      unreadCount,
      hasMore: rows.length > offset + pageSize,
    };
  }

  async function create(userId: string, input: TNotificationCreateRequest): Promise<TNotification> {
    const created = await notifications.createNotification({
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
      data: input.data,
    });
    const serialized = serializeNotification(created);
    if (deps.onCreated) {
      try {
        deps.onCreated(userId, serialized);
      } catch (err) {
        logger.error('[notifications] onCreated hook error:', err);
      }
    }
    return serialized;
  }

  async function markRead(userId: string, id: string): Promise<TNotification | null> {
    const updated = await notifications.markNotificationRead(userId, id);
    return updated == null ? null : serializeNotification(updated);
  }

  async function markAllRead(userId: string): Promise<number> {
    return await notifications.markAllNotificationsRead(userId);
  }

  async function remove(userId: string, id: string): Promise<boolean> {
    return await notifications.deleteNotification(userId, id);
  }

  async function unreadCount(userId: string): Promise<number> {
    return await notifications.countUnreadNotifications(userId);
  }

  return { list, create, markRead, markAllRead, remove, unreadCount };
}
