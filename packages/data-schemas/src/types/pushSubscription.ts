import type { Types, Document } from 'mongoose';

/** Web Push subscription endpoints registered for one user's browser profile. */
export interface IPushSubscription extends Document {
  userId: Types.ObjectId;
  /** Unique push service endpoint URL for a browser + service-worker pair. */
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  /** Free-text browser/OS description captured at subscribe time for operator triage. */
  userAgent?: string;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UpsertPushSubscriptionInput {
  userId: string | Types.ObjectId;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
}

export interface PushSubscriptionLean {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
  __v?: number;
}
