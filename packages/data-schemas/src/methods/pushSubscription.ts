import type { Model } from 'mongoose';
import type {
  IPushSubscription,
  PushSubscriptionLean,
  UpsertPushSubscriptionInput,
} from '~/types/pushSubscription';
import { isValidObjectIdString } from '~/utils/objectId';

export interface PushSubscriptionMethods {
  /** Creates the row or refreshes the keys/userAgent when the endpoint re-subscribes. */
  upsertPushSubscription(input: UpsertPushSubscriptionInput): Promise<PushSubscriptionLean>;
  listPushSubscriptions(userId: string): Promise<PushSubscriptionLean[]>;
  /** Removes one endpoint for its owner; returns whether a row was deleted. */
  deletePushSubscription(userId: string, endpoint: string): Promise<boolean>;
  /** System-actor removal used when a push service reports the endpoint gone. */
  deletePushSubscriptionByEndpoint(endpoint: string): Promise<boolean>;
}

export function createPushSubscriptionMethods(
  mongoose: typeof import('mongoose'),
): PushSubscriptionMethods {
  const PushSubscription = (): Model<IPushSubscription> =>
    mongoose.models.PushSubscription as Model<IPushSubscription>;

  async function upsertPushSubscription(
    input: UpsertPushSubscriptionInput,
  ): Promise<PushSubscriptionLean> {
    const created = await PushSubscription().findOneAndUpdate(
      { endpoint: input.endpoint },
      {
        $set: {
          userId: new mongoose.Types.ObjectId(String(input.userId)),
          keys: input.keys,
          userAgent: input.userAgent,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return created!.toObject() as PushSubscriptionLean;
  }

  async function listPushSubscriptions(userId: string): Promise<PushSubscriptionLean[]> {
    if (!isValidObjectIdString(userId)) {
      return [];
    }
    return await PushSubscription()
      .find({ userId })
      .lean<PushSubscriptionLean[]>();
  }

  async function deletePushSubscription(userId: string, endpoint: string): Promise<boolean> {
    if (!isValidObjectIdString(userId) || !endpoint) {
      return false;
    }
    const result = await PushSubscription().deleteOne({ userId, endpoint });
    return result.deletedCount === 1;
  }

  async function deletePushSubscriptionByEndpoint(endpoint: string): Promise<boolean> {
    if (!endpoint) {
      return false;
    }
    const result = await PushSubscription().deleteOne({ endpoint });
    return result.deletedCount === 1;
  }

  return {
    upsertPushSubscription,
    listPushSubscriptions,
    deletePushSubscription,
    deletePushSubscriptionByEndpoint,
  };
}
