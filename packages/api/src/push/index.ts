import { z } from 'zod';
import { logger } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { PushSubscriptionLean } from '@librechat/data-schemas';
import type { ServerRequest } from '~/types/http';

/** The storage-shaped subscription a push service accepts (endpoint + client keys). */
export interface PushSubscriptionTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Push subscription storage, injected from the api wiring layer. */
export interface PushSubscriptionStore {
  upsertPushSubscription(input: {
    userId: string;
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userAgent?: string;
  }): Promise<PushSubscriptionLean>;
  listPushSubscriptions(userId: string): Promise<PushSubscriptionLean[]>;
  deletePushSubscription(userId: string, endpoint: string): Promise<boolean>;
  deletePushSubscriptionByEndpoint(endpoint: string): Promise<boolean>;
}

export interface PushPayload {
  title: string;
  body?: string;
  link?: string;
}

export interface PushDispatcherDeps {
  subscriptions: Pick<
    PushSubscriptionStore,
    'listPushSubscriptions' | 'deletePushSubscriptionByEndpoint'
  >;
  /**
   * Sends one JSON payload string to one subscription. Throws with a numeric
   * `statusCode`; `404`/`410` mark the endpoint gone and trigger pruning.
   */
  send(subscription: PushSubscriptionTarget, payload: string): Promise<void>;
}

export interface PushDispatcher {
  /** Pushes to every subscription of a user; prunes gone endpoints. Returns delivered count. */
  dispatch(userId: string, payload: PushPayload): Promise<number>;
}

/**
 * Web Push fan-out: deliver one notification to all of a user's registered
 * endpoints. Failures are per-endpoint and never propagate — the caller is the
 * fire-and-forget notification seam — and a push service's 404/410 means the
 * browser profile is gone, so the stale row is pruned on the spot.
 */
export function createPushDispatcher(deps: PushDispatcherDeps): PushDispatcher {
  async function dispatch(userId: string, payload: PushPayload): Promise<number> {
    let subscriptions: PushSubscriptionLean[];
    try {
      subscriptions = await deps.subscriptions.listPushSubscriptions(userId);
    } catch (err) {
      logger.error('[push] Failed to list subscriptions:', err);
      return 0;
    }
    let delivered = 0;
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await deps.send(
            { endpoint: subscription.endpoint, keys: subscription.keys },
            JSON.stringify(payload),
          );
          delivered += 1;
        } catch (err) {
          const status = (err as { statusCode?: unknown })?.statusCode;
          if (status === 404 || status === 410) {
            await deps.subscriptions
              .deletePushSubscriptionByEndpoint(subscription.endpoint)
              .catch(() => false);
            return;
          }
          logger.debug('[push] Send failed for %s:', subscription.endpoint, err);
        }
      }),
    );
    return delivered;
  }

  return { dispatch };
}

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
  userAgent: z.string().max(400).optional(),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().min(1).max(2048),
});

export interface PushHandlersDeps {
  subscriptions: PushSubscriptionStore;
  dispatcher?: PushDispatcher;
  /** VAPID public key served to browsers for `pushManager.subscribe`. */
  publicKey?: string;
}

export interface PushHandlers {
  getPushConfig: (req: ServerRequest, res: Response) => Promise<Response>;
  subscribe: (req: ServerRequest, res: Response) => Promise<Response>;
  unsubscribe: (req: ServerRequest, res: Response) => Promise<Response>;
}

/**
 * `/api/push` handlers. The feature is available when the wiring layer supplied
 * a VAPID key and dispatcher; otherwise every route reports the feature as off.
 */
export function createPushHandlers(deps: PushHandlersDeps): PushHandlers {
  const configured = !!(deps.publicKey && deps.dispatcher);

  function resolveUserId(req: ServerRequest): string | null {
    const id = req.user?.id ?? req.user?._id;
    return id == null ? null : String(id);
  }

  async function getPushConfig(req: ServerRequest, res: Response): Promise<Response> {
    const enabled =
      resolveUserId(req) != null &&
      configured &&
      req.config?.config?.webPush?.enabled === true;
    if (!enabled) {
      return res.status(200).json({ enabled: false });
    }
    return res.status(200).json({ enabled: true, publicKey: deps.publicKey });
  }

  async function subscribe(req: ServerRequest, res: Response): Promise<Response> {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!configured || req.config?.config?.webPush?.enabled !== true) {
      return res.status(404).json({ error: 'Push notifications are not available' });
    }
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid push subscription' });
    }
    try {
      await deps.subscriptions.upsertPushSubscription({
        userId,
        endpoint: parsed.data.endpoint,
        keys: parsed.data.keys,
        userAgent: parsed.data.userAgent,
      });
      return res.status(200).json({ subscribed: true });
    } catch (err) {
      logger.error('[push] Subscribe error:', err);
      return res.status(500).json({ error: 'Failed to subscribe' });
    }
  }

  async function unsubscribe(req: ServerRequest, res: Response): Promise<Response> {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const parsed = unsubscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid endpoint' });
    }
    try {
      await deps.subscriptions.deletePushSubscription(userId, parsed.data.endpoint);
      return res.status(200).json({ deleted: true });
    } catch (err) {
      logger.error('[push] Unsubscribe error:', err);
      return res.status(500).json({ error: 'Failed to unsubscribe' });
    }
  }

  return { getPushConfig, subscribe, unsubscribe };
}
