import type { Model } from 'mongoose';
import type {
  ISubscription,
  ISubscriptionDocument,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
  ListSubscriptionsOptions,
} from '~/types/subscription';
import { isValidObjectIdString } from '~/utils/objectId';

export interface SubscriptionMethods {
  createSubscription(input: CreateSubscriptionInput): Promise<ISubscription>;
  getSubscription(subscriptionId: string): Promise<ISubscription | null>;
  /** A user's subscriptions, newest first. */
  listSubscriptions(options?: ListSubscriptionsOptions): Promise<ISubscription[]>;
  /** Applies a billing-state change without touching provider linkage. */
  updateSubscription(
    subscriptionId: string,
    patch: UpdateSubscriptionInput,
  ): Promise<ISubscription | null>;
  deleteSubscription(subscriptionId: string): Promise<boolean>;
}

export function createSubscriptionMethods(
  mongoose: typeof import('mongoose'),
): SubscriptionMethods {
  const Subscription = (): Model<ISubscriptionDocument> =>
    mongoose.models.Subscription as Model<ISubscriptionDocument>;

  async function createSubscription(input: CreateSubscriptionInput): Promise<ISubscription> {
    if (!isValidObjectIdString(input.userId)) {
      throw new Error('A valid userId is required');
    }

    const created = await Subscription().create({
      userId: input.userId,
      plan: input.plan,
      status: input.status ?? 'active',
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      priceId: input.priceId,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      cancelAt: input.cancelAt,
      canceledAt: input.canceledAt,
      trialEndsAt: input.trialEndsAt,
      quantity: input.quantity,
      metadata: input.metadata,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    });
    return created.toObject() as ISubscription;
  }

  async function getSubscription(subscriptionId: string): Promise<ISubscription | null> {
    if (!isValidObjectIdString(subscriptionId)) {
      return null;
    }
    return await Subscription().findById(subscriptionId).lean<ISubscription>();
  }

  async function listSubscriptions(options?: ListSubscriptionsOptions): Promise<ISubscription[]> {
    const filter: Record<string, unknown> = {};
    if (options?.userId) {
      if (!isValidObjectIdString(options.userId)) {
        return [];
      }
      filter.userId = options.userId;
    }
    if (options?.plan !== undefined) {
      filter.plan = options.plan;
    }
    if (options?.status !== undefined) {
      filter.status = options.status;
    }
    if (options?.tenantId) {
      filter.tenantId = options.tenantId;
    }
    return await Subscription()
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .lean<ISubscription[]>();
  }

  async function updateSubscription(
    subscriptionId: string,
    patch: UpdateSubscriptionInput,
  ): Promise<ISubscription | null> {
    if (!isValidObjectIdString(subscriptionId)) {
      return null;
    }

    const update: Record<string, unknown> = {};
    if (patch.plan !== undefined) {
      update.plan = patch.plan;
    }
    if (patch.status !== undefined) {
      update.status = patch.status;
    }
    if (patch.priceId !== undefined) {
      update.priceId = patch.priceId;
    }
    if (patch.currentPeriodStart !== undefined) {
      update.currentPeriodStart = patch.currentPeriodStart;
    }
    if (patch.currentPeriodEnd !== undefined) {
      update.currentPeriodEnd = patch.currentPeriodEnd;
    }
    if (patch.cancelAt !== undefined) {
      update.cancelAt = patch.cancelAt;
    }
    if (patch.canceledAt !== undefined) {
      update.canceledAt = patch.canceledAt;
    }
    if (patch.trialEndsAt !== undefined) {
      update.trialEndsAt = patch.trialEndsAt;
    }
    if (patch.quantity !== undefined) {
      update.quantity = patch.quantity;
    }
    if (patch.metadata !== undefined) {
      update.metadata = patch.metadata;
    }

    return await Subscription()
      .findByIdAndUpdate(subscriptionId, { $set: update }, { new: true, runValidators: true })
      .lean<ISubscription>();
  }

  async function deleteSubscription(subscriptionId: string): Promise<boolean> {
    if (!isValidObjectIdString(subscriptionId)) {
      return false;
    }
    const deleted = await Subscription().findOneAndDelete({ _id: subscriptionId });
    return !!deleted;
  }

  return {
    createSubscription,
    getSubscription,
    listSubscriptions,
    updateSubscription,
    deleteSubscription,
  };
}
