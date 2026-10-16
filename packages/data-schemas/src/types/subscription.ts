import type { Document, Types } from 'mongoose';

/** The billing tier a subscription is on. */
export type SubscriptionPlan = 'free' | 'basic' | 'pro' | 'enterprise';

/** Lifecycle state mirrored from the billing provider. */
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete';

/**
 * A user's billing subscription (blueprint §45 `subscriptions`).
 *
 * The row is a local projection of the payment provider's state: the plan the
 * user is entitled to and the period it covers. Provider identifiers are kept
 * so a webhook can reconcile without a second lookup.
 */
export interface ISubscription {
  _id?: Types.ObjectId;
  userId: Types.ObjectId;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  priceId?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAt?: Date;
  canceledAt?: Date;
  trialEndsAt?: Date;
  quantity?: number;
  metadata?: Record<string, unknown>;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISubscriptionDocument extends Omit<ISubscription, '_id'>, Document {}

export interface CreateSubscriptionInput {
  userId: string;
  plan: SubscriptionPlan;
  status?: SubscriptionStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  priceId?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAt?: Date;
  canceledAt?: Date;
  trialEndsAt?: Date;
  quantity?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateSubscriptionInput {
  plan?: SubscriptionPlan;
  status?: SubscriptionStatus;
  priceId?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAt?: Date;
  canceledAt?: Date;
  trialEndsAt?: Date;
  quantity?: number;
  metadata?: Record<string, unknown>;
}

export interface ListSubscriptionsOptions {
  userId?: string;
  plan?: SubscriptionPlan;
  status?: SubscriptionStatus;
}
