import { z } from 'zod';
import { isValidObjectIdString, logger } from '@librechat/data-schemas';
import type { CreateSubscriptionInput, UpdateSubscriptionInput } from '@librechat/data-schemas';
import type { Response } from 'express';
import type {
  SubscriptionDataSource,
  SubscriptionDTO,
  SubscriptionRecord,
  SubscriptionsHandlers,
} from './types';
import type { ServerRequest } from '~/types';
import { resolveRequestTenantId } from '~/middleware/tenant';
import { queryString } from '~/utils/query';

const PLANS = ['free', 'basic', 'pro', 'enterprise'] as const;
const STATUSES = ['active', 'canceled', 'past_due', 'trialing', 'incomplete'] as const;

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

const createSubscriptionSchema = z.object({
  plan: z.enum(['free', 'basic', 'pro', 'enterprise']),
  status: z.enum(['active', 'canceled', 'past_due', 'trialing', 'incomplete']).optional(),
  stripeCustomerId: z.string().trim().min(1).optional(),
  stripeSubscriptionId: z.string().trim().min(1).optional(),
  priceId: z.string().trim().min(1).optional(),
  currentPeriodStart: z.coerce.date().optional(),
  currentPeriodEnd: z.coerce.date().optional(),
  cancelAt: z.coerce.date().optional(),
  canceledAt: z.coerce.date().optional(),
  trialEndsAt: z.coerce.date().optional(),
  quantity: z.number().int().min(0).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateSubscriptionSchema = createSubscriptionSchema
  .omit({
    stripeCustomerId: true,
    stripeSubscriptionId: true,
  })
  .partial();

interface Actor {
  userId: string;
  tenantId?: string;
}

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return 'Invalid subscription payload';
  }
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

function toIso(value?: Date | string): string | undefined {
  if (value == null) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function serializeSubscription(record: SubscriptionRecord): SubscriptionDTO {
  return {
    id: record._id == null ? '' : String(record._id),
    userId: record.userId == null ? '' : String(record.userId),
    plan: record.plan,
    status: record.status ?? 'active',
    stripeCustomerId: record.stripeCustomerId,
    stripeSubscriptionId: record.stripeSubscriptionId,
    priceId: record.priceId,
    currentPeriodStart: toIso(record.currentPeriodStart),
    currentPeriodEnd: toIso(record.currentPeriodEnd),
    cancelAt: toIso(record.cancelAt),
    canceledAt: toIso(record.canceledAt),
    trialEndsAt: toIso(record.trialEndsAt),
    quantity: record.quantity,
    metadata: record.metadata,
    tenantId: record.tenantId,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

/** A record is visible only to its owner and only within the requester's tenant. */
function isVisible(record: SubscriptionRecord, actor: Actor): boolean {
  const owner = record.userId == null ? '' : String(record.userId);
  if (owner !== actor.userId) {
    return false;
  }
  if (record.tenantId != null && actor.tenantId != null && record.tenantId !== actor.tenantId) {
    return false;
  }
  return true;
}

export function createSubscriptionsHandlers(deps: SubscriptionDataSource): SubscriptionsHandlers {
  function resolveActor(req: ServerRequest, res: Response): Actor | null {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return null;
    }
    return { userId, tenantId: resolveRequestTenantId(req) };
  }

  function resolveId(req: ServerRequest, res: Response): string | null {
    const { id } = req.params as { id?: string };
    if (!id || !isValidObjectIdString(id)) {
      res.status(400).json({ error: 'Invalid subscription id' });
      return null;
    }
    return id;
  }

  async function list(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const rawPlan = queryString(req.query.plan);
    let plan: (typeof PLANS)[number] | undefined;
    if (rawPlan != null) {
      if (!isOneOf(PLANS, rawPlan)) {
        return res.status(400).json({ error: 'plan is invalid' });
      }
      plan = rawPlan;
    }
    const rawStatus = queryString(req.query.status);
    let status: (typeof STATUSES)[number] | undefined;
    if (rawStatus != null) {
      if (!isOneOf(STATUSES, rawStatus)) {
        return res.status(400).json({ error: 'status is invalid' });
      }
      status = rawStatus;
    }
    try {
      const subscriptions = await deps.listSubscriptions({
        userId: actor.userId,
        plan,
        status,
      });
      return res.status(200).json({ subscriptions: subscriptions.map(serializeSubscription) });
    } catch (error) {
      logger.error('[subscriptions] Error listing subscriptions', error);
      return res.status(500).json({ error: 'Error listing subscriptions' });
    }
  }

  async function get(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const id = resolveId(req, res);
    if (!id) {
      return res;
    }
    try {
      const subscription = await deps.getSubscription(id);
      if (!subscription || !isVisible(subscription, actor)) {
        return res.status(404).json({ error: 'Subscription not found' });
      }
      return res.status(200).json(serializeSubscription(subscription));
    } catch (error) {
      logger.error('[subscriptions] Error fetching subscription', error);
      return res.status(500).json({ error: 'Error fetching subscription' });
    }
  }

  async function create(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const parsed = createSubscriptionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: describeIssue(parsed.error) });
    }
    try {
      const input: CreateSubscriptionInput = { ...parsed.data, userId: actor.userId };
      const created = await deps.createSubscription(input);
      return res.status(201).json(serializeSubscription(created));
    } catch (error) {
      logger.error('[subscriptions] Error creating subscription', error);
      return res.status(500).json({ error: 'Error creating subscription' });
    }
  }

  async function update(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const id = resolveId(req, res);
    if (!id) {
      return res;
    }
    const parsed = updateSubscriptionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: describeIssue(parsed.error) });
    }
    const patch: UpdateSubscriptionInput = parsed.data;
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'At least one field must be provided for update' });
    }
    try {
      const existing = await deps.getSubscription(id);
      if (!existing || !isVisible(existing, actor)) {
        return res.status(404).json({ error: 'Subscription not found' });
      }
      const updated = await deps.updateSubscription(id, patch);
      if (!updated) {
        return res.status(404).json({ error: 'Subscription not found' });
      }
      return res.status(200).json(serializeSubscription(updated));
    } catch (error) {
      logger.error('[subscriptions] Error updating subscription', error);
      return res.status(500).json({ error: 'Error updating subscription' });
    }
  }

  async function remove(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const id = resolveId(req, res);
    if (!id) {
      return res;
    }
    try {
      const existing = await deps.getSubscription(id);
      if (!existing || !isVisible(existing, actor)) {
        return res.status(404).json({ error: 'Subscription not found' });
      }
      const deleted = await deps.deleteSubscription(id);
      if (!deleted) {
        return res.status(404).json({ error: 'Subscription not found' });
      }
      return res.status(200).json({ deleted: true });
    } catch (error) {
      logger.error('[subscriptions] Error deleting subscription', error);
      return res.status(500).json({ error: 'Error deleting subscription' });
    }
  }

  return { list, get, create, update, delete: remove };
}
