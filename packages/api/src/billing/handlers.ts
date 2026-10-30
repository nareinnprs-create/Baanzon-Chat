import { z } from 'zod';
import { logger } from '@librechat/data-schemas';
import {
  billingConfigSchema,
  ENTITLEMENT_PLAN_KEYS,
  ENTITLEMENT_RESOURCE_KEYS,
} from 'librechat-data-provider';
import type { TEntitlementLimitsConfig, TEntitlementLimitsMatrix } from 'librechat-data-provider';
import type { Response } from 'express';
import type {
  EntitlementHandlerActor,
  EntitlementHandlers,
  EntitlementHandlersDeps,
} from './types';
import type { MembershipRecord, OrganizationRecord } from '../organizations/types';
import type { ServerRequest } from '~/types/http';
import { matchesTenant, meetsRole, resolveOrganizationRole } from '../organizations/access';
import { resolveRequestTenantId } from '~/middleware/tenant';

const AUTH_REQUIRED = 'Authentication required';
const UNKNOWN_PLAN = 'Unknown entitlement plan';
const UNKNOWN_RESOURCE = 'Unknown entitlement resource';
const INVALID_ENTITLEMENT_PAYLOAD = 'Invalid entitlement payload';
const WRITE_FORBIDDEN = 'Insufficient organization permissions';

const knownPlans = new Set<string>(ENTITLEMENT_PLAN_KEYS as readonly string[]);
const knownResources = new Set<string>(ENTITLEMENT_RESOURCE_KEYS as readonly string[]);

const setEntitlementRequestSchema = z.object({
  limit: z.number().int().min(-1),
  scope: z.enum(['global', 'organization']).default('organization'),
  scopeId: z.string().trim().min(1),
});

function resolveActor(req: ServerRequest): EntitlementHandlerActor | null {
  const user = req.user;
  if (!user) {
    return null;
  }
  const userId = user._id?.toString() ?? user.id;
  if (!userId) {
    return null;
  }
  return { userId, tenantId: resolveRequestTenantId(req) };
}

/**
 * Resolve the base config levers for a request. `billingConfigSchema` leaves
 * the whole `limits` block optional, so an absent lever block reproduces
 * today's unlimited behavior and DB entitlements still win on top of it.
 */
function resolveConfigLevers(req: ServerRequest): Partial<TEntitlementLimitsConfig> {
  const raw = req.config?.config?.billing;
  if (!raw) {
    return {};
  }
  const parsed = billingConfigSchema.safeParse(raw);
  return parsed.success ? (parsed.data.limits ?? {}) : {};
}

/**
 * Express handlers for the entitlement service, mirroring the flags handlers:
 * the injected service does the work, inputs are validated before the store is
 * touched, and resolution is read-only for every authenticated caller.
 */
export function createEntitlementHandlers(deps: EntitlementHandlersDeps): EntitlementHandlers {
  const { service, access } = deps;

  async function getEntitlements(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req);
    if (!actor) {
      return res.status(401).json({ error: AUTH_REQUIRED });
    }
    try {
      const organizationId =
        typeof req.query.organizationId === 'string' ? req.query.organizationId : undefined;
      const entitlements: TEntitlementLimitsMatrix = await service.resolveEntitlements({
        config: resolveConfigLevers(req),
        organizationId,
      });
      return res.status(200).json({ entitlements });
    } catch (error) {
      logger.error('[billing] Error resolving entitlements', error);
      return res.status(500).json({ error: 'Error resolving entitlements' });
    }
  }

  /**
   * No deployment-admin middleware is reachable from this module, so
   * entitlement writes are gated through the workspace access seam exactly as
   * the flags handlers gate override writes: the caller must hold admin-or-owner
   * rank in the organization named by the body's `scopeId` (`owner` rank for
   * `global`, since a deployment-wide limit outranks any one organization's
   * admins). `scopeId` is only stored for organization rows; for `global` it
   * anchors the permission check alone.
   */
  async function setEntitlement(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req);
    if (!actor) {
      return res.status(401).json({ error: AUTH_REQUIRED });
    }
    const { plan, resource } = (req.params ?? {}) as {
      plan?: string;
      resource?: string;
    };
    if (typeof plan !== 'string' || !knownPlans.has(plan)) {
      return res.status(400).json({ error: UNKNOWN_PLAN });
    }
    if (typeof resource !== 'string' || !knownResources.has(resource)) {
      return res.status(400).json({ error: UNKNOWN_RESOURCE });
    }
    const parsed = setEntitlementRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: INVALID_ENTITLEMENT_PAYLOAD });
    }
    const { limit, scope, scopeId } = parsed.data;

    let organization: OrganizationRecord | null = null;
    let membership: MembershipRecord | null = null;
    try {
      [organization, membership] = await Promise.all([
        access.getOrganization(scopeId),
        access.getMembership(scopeId, actor.userId),
      ]);
    } catch (error) {
      logger.error('[billing] Error loading organization for entitlement write', error);
      return res.status(500).json({ error: 'Error loading organization' });
    }

    /**
     * A missing organization means the scopeId names nothing real, so there is
     * nothing to rank the caller against — fail closed with 403 either way so
     * an outsider cannot distinguish "empty" from "insufficient".
     */
    const role = organization
      ? resolveOrganizationRole({ organization, membership, userId: actor.userId })
      : null;
    const minimum = scope === 'global' ? 'owner' : 'admin';
    if (
      role === null ||
      !meetsRole(role, minimum) ||
      !matchesTenant(organization?.tenantId, actor.tenantId)
    ) {
      return res.status(403).json({ error: WRITE_FORBIDDEN });
    }

    try {
      const entitlement = await service.setEntitlement({
        plan: plan as (typeof ENTITLEMENT_PLAN_KEYS)[number],
        resource: resource as (typeof ENTITLEMENT_RESOURCE_KEYS)[number],
        scope,
        // A global row must not carry a scopeId (the store rejects one).
        scopeId: scope === 'global' ? undefined : scopeId,
        limit,
      });
      return res.status(200).json({
        plan: entitlement.plan,
        resource: entitlement.resource,
        scope: entitlement.scope,
        scopeId: entitlement.scopeId ?? null,
        limit: entitlement.limit,
      });
    } catch (error) {
      logger.error('[billing] Error setting entitlement', error);
      return res.status(500).json({ error: 'Error setting entitlement' });
    }
  }

  return { getEntitlements, setEntitlement };
}
