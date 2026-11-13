import { Schema } from 'mongoose';
import type { IPushSubscription } from '~/types/pushSubscription';

const PushSubscriptionSchema: Schema<IPushSubscription> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      required: true,
    },
    endpoint: {
      type: String,
      required: true,
    },
    keys: {
      p256dh: {
        type: String,
        required: true,
      },
      auth: {
        type: String,
        required: true,
      },
    },
    userAgent: {
      type: String,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

/** One subscription row per push endpoint; a re-subscribe refreshes keys in place. */
PushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });

export default PushSubscriptionSchema;
