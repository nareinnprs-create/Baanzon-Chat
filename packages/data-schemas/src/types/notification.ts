import type { Document, Types } from 'mongoose';

/** What produced a notification; drives grouping and iconography on the client. */
export type NotificationType =
  | 'system'
  | 'agent_run'
  | 'mention'
  | 'share'
  | 'schedule'
  | 'knowledge';

/**
 * A per-user notification (blueprint §45 `notifications`).
 *
 * Notifications are owner-scoped: a user only ever reads their own rows, so the
 * read/mark methods filter on `userId` in addition to the ambient tenant filter.
 */
export interface INotification {
  _id?: Types.ObjectId;
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body?: string;
  /** In-app deep link the notification points at. */
  link?: string;
  read: boolean;
  readAt?: Date | null;
  /** Type-specific payload; opaque to this package. */
  data?: Record<string, unknown>;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface INotificationDocument extends Omit<INotification, '_id'>, Document {}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  data?: Record<string, unknown>;
}

export interface ListNotificationsOptions {
  unreadOnly?: boolean;
  limit?: number;
}
