import type { Model } from 'mongoose';
import type {
  INotification,
  INotificationDocument,
  CreateNotificationInput,
  ListNotificationsOptions,
} from '~/types/notification';
import { isValidObjectIdString } from '~/utils/objectId';

/** Default page size for a notification feed. */
export const NOTIFICATION_LIST_DEFAULT_LIMIT = 50;
/** Hard cap on a notification feed page. */
export const NOTIFICATION_LIST_MAX_LIMIT = 200;

function normalizeLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    return NOTIFICATION_LIST_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), NOTIFICATION_LIST_MAX_LIMIT);
}

export interface NotificationMethods {
  createNotification(input: CreateNotificationInput): Promise<INotification>;
  listNotifications(userId: string, options?: ListNotificationsOptions): Promise<INotification[]>;
  countUnreadNotifications(userId: string): Promise<number>;
  markNotificationRead(userId: string, notificationId: string): Promise<INotification | null>;
  /** Marks every unread notification read; returns how many changed. */
  markAllNotificationsRead(userId: string): Promise<number>;
  deleteNotification(userId: string, notificationId: string): Promise<boolean>;
}

export function createNotificationMethods(
  mongoose: typeof import('mongoose'),
): NotificationMethods {
  const Notification = (): Model<INotificationDocument> =>
    mongoose.models.Notification as Model<INotificationDocument>;

  async function createNotification(input: CreateNotificationInput): Promise<INotification> {
    const created = await Notification().create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
      data: input.data,
      read: false,
    });
    return created.toObject() as INotification;
  }

  async function listNotifications(
    userId: string,
    options?: ListNotificationsOptions,
  ): Promise<INotification[]> {
    if (!isValidObjectIdString(userId)) {
      return [];
    }
    const filter: { userId: string; read?: boolean } = { userId };
    if (options?.unreadOnly) {
      filter.read = false;
    }
    return await Notification()
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(normalizeLimit(options?.limit))
      .lean<INotification[]>();
  }

  async function countUnreadNotifications(userId: string): Promise<number> {
    if (!isValidObjectIdString(userId)) {
      return 0;
    }
    return await Notification().countDocuments({ userId, read: false });
  }

  async function markNotificationRead(
    userId: string,
    notificationId: string,
  ): Promise<INotification | null> {
    if (!isValidObjectIdString(userId) || !isValidObjectIdString(notificationId)) {
      return null;
    }
    return await Notification()
      .findOneAndUpdate(
        { _id: notificationId, userId },
        { $set: { read: true, readAt: new Date() } },
        { new: true },
      )
      .lean<INotification>();
  }

  async function markAllNotificationsRead(userId: string): Promise<number> {
    if (!isValidObjectIdString(userId)) {
      return 0;
    }
    const result = await Notification().updateMany(
      { userId, read: false },
      { $set: { read: true, readAt: new Date() } },
    );
    return result.modifiedCount ?? 0;
  }

  async function deleteNotification(userId: string, notificationId: string): Promise<boolean> {
    if (!isValidObjectIdString(userId) || !isValidObjectIdString(notificationId)) {
      return false;
    }
    const result = await Notification().deleteOne({ _id: notificationId, userId });
    return result.deletedCount === 1;
  }

  return {
    createNotification,
    listNotifications,
    countUnreadNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification,
  };
}
