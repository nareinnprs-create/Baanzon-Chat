/** What produced a notification; mirrors the storage enum and drives client iconography. */
export type TNotificationType =
  | 'system'
  | 'agent_run'
  | 'mention'
  | 'share'
  | 'schedule'
  | 'knowledge';

/** A per-user notification serialized for the wire (Mongoose-free). */
export type TNotification = {
  id: string;
  type: TNotificationType;
  title: string;
  body?: string;
  /** In-app deep link the notification points at. */
  link?: string;
  read: boolean;
  readAt: string | null;
  /** Type-specific payload; opaque to the client. */
  data?: Record<string, unknown>;
  createdAt: string;
};

/** Server-resolved feature settings so the client can honor toggles without `/api/config`. */
export type TNotificationsSettings = {
  enabled: boolean;
  realtime: boolean;
  pollingIntervalMs: number;
};

export type TNotificationsListParams = {
  limit?: number;
  page?: number;
  unreadOnly?: boolean;
};

export type TNotificationsListResponse = {
  notifications: TNotification[];
  unreadCount: number;
  hasMore: boolean;
  settings: TNotificationsSettings;
};

export type TNotificationsUnreadCountResponse = {
  count: number;
  settings: TNotificationsSettings;
};

export type TNotificationResponse = {
  notification: TNotification;
};

export type TNotificationsMarkAllReadResponse = {
  modified: number;
};

export type TNotificationDeleteResponse = {
  deleted: boolean;
};

export type TNotificationCreateRequest = {
  type: TNotificationType;
  title: string;
  body?: string;
  link?: string;
  data?: Record<string, unknown>;
};
