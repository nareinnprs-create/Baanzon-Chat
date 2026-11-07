import type {
  CreateSubscriptionInput,
  ListSubscriptionsOptions,
  SubscriptionPlan,
  SubscriptionStatus,
  UpdateSubscriptionInput,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types';

/**
 * Storage-shaped subscription row. Kept Mongoose-free so `packages/api` never
 * carries `Types.ObjectId` / `Document` in an exported signature; the injected
 * data-schemas methods return values structurally compatible with this.
 */
export interface SubscriptionRecord {
  _id?: unknown;
  userId?: unknown;
  plan: SubscriptionPlan;
  status?: SubscriptionStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  priceId?: string;
  currentPeriodStart?: Date | string;
  currentPeriodEnd?: Date | string;
  cancelAt?: Date | string;
  canceledAt?: Date | string;
  trialEndsAt?: Date | string;
  quantity?: number;
  metadata?: Record<string, unknown>;
  tenantId?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

/** Wire shape returned by the subscriptions API; ids are strings and dates are ISO-8601. */
export interface SubscriptionDTO {
  id: string;
  userId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  priceId?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAt?: string;
  canceledAt?: string;
  trialEndsAt?: string;
  quantity?: number;
  metadata?: Record<string, unknown>;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** `POST /api/subscriptions` body. `userId` is never accepted from the body. */
export interface SubscriptionCreateRequest {
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

/** `PATCH /api/subscriptions/:id` body. Provider linkage is immutable here. */
export interface SubscriptionUpdateRequest {
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

/** `GET /api/subscriptions` query filters. The owner is always the authenticated user. */
export interface SubscriptionListQuery {
  plan?: SubscriptionPlan;
  status?: SubscriptionStatus;
}

/** The subset of `packages/data-schemas` subscription methods the handlers depend on. */
export interface SubscriptionDataSource {
  createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionRecord>;
  getSubscription(subscriptionId: string): Promise<SubscriptionRecord | null>;
  listSubscriptions(options?: ListSubscriptionsOptions): Promise<SubscriptionRecord[]>;
  updateSubscription(
    subscriptionId: string,
    patch: UpdateSubscriptionInput,
  ): Promise<SubscriptionRecord | null>;
  deleteSubscription(subscriptionId: string): Promise<boolean>;
}

export interface SubscriptionsHandlers {
  list: (req: ServerRequest, res: Response) => Promise<Response>;
  get: (req: ServerRequest, res: Response) => Promise<Response>;
  create: (req: ServerRequest, res: Response) => Promise<Response>;
  update: (req: ServerRequest, res: Response) => Promise<Response>;
  delete: (req: ServerRequest, res: Response) => Promise<Response>;
}
