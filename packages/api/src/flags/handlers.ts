import { z } from 'zod';
import { logger } from '@librechat/data-schemas';
import { FEATURE_FLAG_KEYS, featureFlagsConfigSchema } from 'librechat-data-provider';
import type { TFeatureFlagMap } from 'librechat-data-provider';
import type { Response } from 'express';
import type { MembershipRecord, OrganizationRecord } from '../organizations/types';
import type { FlagHandlerActor, FlagHandlers, FlagHandlersDeps } from './types';
import type { ServerRequest } from '~/types/http';
import { matchesTenant, meetsRole, resolveOrganizationRole } from '../organizations/access';
import { resolveRequestTenantId } from '~/middleware/tenant';

const AUTH_REQUIRED = 'Authentication required';
const UNKNOWN_FLAG_KEY = 'Unknown feature flag';
const INVALID_FLAG_PAYLOAD = 'Invalid feature flag payload';
const WRITE_FORBIDDEN = 'Insufficient organization permissions';

const knownKeys = new Set<string>(FEATURE_FLAG_KEYS as readonly string[]);

const setFlagRequestSchema = z.object({
  value: z.boolean(),
  scope: z.enum(['global', 'organization']).default('organization'),
  scopeId: z.string().trim().min(1),
});

function resolveActor(req: ServerRequest): FlagHandlerActor | null {
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
 * Resolve the base config levers for a request. `featureFlagsConfigSchema`
 * defaults every shipped flag to `true`, so an absent lever block reproduces
 * today's behavior and DB overrides still win on top of it.
 */
function resolveConfigLevers(req: ServerRequest): Partial<TFeatureFlagMap> {
  const raw = req.config?.config?.featureFlags;
  if (!raw) {
    return {};
  }
  const parsed = featureFlagsConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/**
 * Express handlers for the feature-flag service, mirroring the organizations
 * handlers: the injected service does the work, inputs are validated before
 * the store is touched, and resolution is read-only for every member.
 */
export function createFlagHandlers(deps: FlagHandlersDeps): FlagHandlers {
  const { service, access } = deps;

  async function getFlags(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req);
    if (!actor) {
      return res.status(401).json({ error: AUTH_REQUIRED });
    }
    try {
      const organizationId =
        typeof req.query.organizationId === 'string' ? req.query.organizationId : undefined;
      const flags = await service.resolveFlags({
        config: resolveConfigLevers(req),
        organizationId,
      });
      return res.status(200).json({ flags });
    } catch (error) {
      logger.error('[flags] Error resolving feature flags', error);
      return res.status(500).json({ error: 'Error resolving feature flags' });
    }
  }

  /**
   * No deployment-admin middleware is reachable from this module, so override
   * writes are gated through the workspace access seam: the caller must hold
   * admin-or-owner rank in the organization named by the body's `scopeId`
   * (`owner` rank for `global`, since a deployment-wide kill switch outranks
   * any one organization's admins). `scopeId` is only stored for organization
   * rows; for `global` it anchors the permission check alone.
   */
  async function setFlag(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req);
    if (!actor) {
      return res.status(401).json({ error: AUTH_REQUIRED });
    }
    const { key } = (req.params ?? {}) as { key?: string };
    if (typeof key !== 'string' || !knownKeys.has(key)) {
      return res.status(400).json({ error: UNKNOWN_FLAG_KEY });
    }
    const parsed = setFlagRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: INVALID_FLAG_PAYLOAD });
    }
    const { value, scope, scopeId } = parsed.data;

    let organization: OrganizationRecord | null = null;
    let membership: MembershipRecord | null = null;
    try {
      [organization, membership] = await Promise.all([
        access.getOrganization(scopeId),
        access.getMembership(scopeId, actor.userId),
      ]);
    } catch (error) {
      logger.error('[flags] Error loading organization for flag write', error);
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
      const override = await service.setFlag({
        key,
        scope,
        // A global row must not carry a scopeId (the store rejects one).
        scopeId: scope === 'global' ? undefined : scopeId,
        value,
      });
      return res.status(200).json({
        key: override.key,
        scope: override.scope,
        scopeId: override.scopeId ?? null,
        value: override.value,
      });
    } catch (error) {
      logger.error('[flags] Error setting feature flag override', error);
      return res.status(500).json({ error: 'Error setting feature flag' });
    }
  }

  return { getFlags, setFlag };
}
