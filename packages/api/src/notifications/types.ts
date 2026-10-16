import type { TNotificationType } from 'librechat-data-provider';

/**
 * Storage-shaped notification row. Kept Mongoose-free so `packages/api` never
 * carries `Types.ObjectId` / `Document` in an exported signature; the injected
 * data-schemas methods return values structurally compatible with this.
 */
export interface NotificationRecord {
  _id?: unknown;
  userId?: unknown;
  type: string;
  title: string;
  body?: string;
  link?: string;
  read: boolean;
  readAt?: Date | string | null;
  data?: Record<string, unknown>;
  createdAt?: Date | string;
}

export interface CreateNotificationParams {
  userId: string;
  type: TNotificationType;
  title: string;
  body?: string;
  link?: string;
  data?: Record<string, unknown>;
}

export interface NotificationListOptions {
  unreadOnly?: boolean;
  limit?: number;
}

/** The subset of `packages/data-schemas` notification methods the service depends on. */
export interface NotificationDataSource {
  createNotification(input: CreateNotificationParams): Promise<NotificationRecord>;
  listNotifications(
    userId: string,
    options?: NotificationListOptions,
  ): Promise<NotificationRecord[]>;
  countUnreadNotifications(userId: string): Promise<number>;
  markNotificationRead(userId: string, notificationId: string): Promise<NotificationRecord | null>;
  markAllNotificationsRead(userId: string): Promise<number>;
  deleteNotification(userId: string, notificationId: string): Promise<boolean>;
}
