import {
  ENTITLEMENT_PLAN_KEYS,
  ENTITLEMENT_RESOURCE_KEYS,
  PLAN_LIMIT_DEFAULTS,
  UNLIMITED_LIMIT,
} from 'librechat-data-provider';
import type {
  TEntitlementLimitsConfig,
  TEntitlementLimitsMatrix,
  TEntitlementOverride,
  TPlanLimits,
} from 'librechat-data-provider';
import type { AssertWithinLimitInput, EntitlementService, EntitlementServiceDeps } from './types';

const knownResources = new Set<string>(ENTITLEMENT_RESOURCE_KEYS as readonly string[]);

/**
 * Thrown by `assertWithinLimit` when recorded usage has no headroom left under
 * the resolved limit. Pure data - callers decide the HTTP/code mapping.
 */
export class EntitlementLimitError extends Error {
  constructor(
    readonly resource: AssertWithinLimitInput['resource'],
    readonly limit: number,
    readonly used: number,
    readonly principal?: string,
  ) {
    super(
      `Entitlement limit exceeded for ${resource}: used ${used} of ${limit}` +
        (principal ? ` (${principal})` : ''),
    );
    this.name = 'EntitlementLimitError';
  }
}

/**
 * Pure enforcement: a limit below 0 is unlimited, otherwise the next unit fits
 * only while `used` stays strictly below `limit`. Never reads stores or config,
 * so chat-core call sites can invoke it with already-loaded values.
 */
export function assertWithinLimit(params: AssertWithinLimitInput): void {
  // At or below UNLIMITED_LIMIT (-1) the resource is uncapped by contract.
  if (!Number.isFinite(params.limit) || params.limit <= UNLIMITED_LIMIT) {
    return;
  }
  if (params.used >= params.limit) {
    throw new EntitlementLimitError(params.resource, params.limit, params.used, params.principal);
  }
}

/**
 * Pure resolution for one plan: unlimited defaults, then the baanzon.yaml
 * `billing.limits` levers, then stored entitlements. Entitlement rows layer
 * `global` first and `organization` second, so an organization row outranks a
 * global one, which outranks config. Unknown resources anywhere are ignored —
 * a renamed resource leaves stale rows inert instead of surfacing garbage to
 * callers.
 */
export function resolvePlanLimits(
  config: Partial<TEntitlementLimitsConfig> | undefined,
  entitlements: TEntitlementOverride[],
  plan: (typeof ENTITLEMENT_PLAN_KEYS)[number],
): TPlanLimits {
  const resolved: TPlanLimits = { ...PLAN_LIMIT_DEFAULTS[plan] };
  const lever = config?.[plan];
  if (lever) {
    for (const resource of ENTITLEMENT_RESOURCE_KEYS) {
      const value = lever[resource];
      if (typeof value === 'number') {
        resolved[resource] = value;
      }
    }
  }
  const planRows = entitlements.filter((row) => row.plan === plan);
  const globalRows = planRows.filter((row) => row.scope === 'global');
  const orgRows = planRows.filter((row) => row.scope === 'organization');
  for (const row of [...globalRows, ...orgRows]) {
    if (!knownResources.has(row.resource)) {
      continue;
    }
    if (
      typeof row.limit === 'number' &&
      Number.isFinite(row.limit) &&
      row.limit >= UNLIMITED_LIMIT
    ) {
      resolved[row.resource as (typeof ENTITLEMENT_RESOURCE_KEYS)[number]] = row.limit;
    }
  }
  return resolved;
}

/** Resolves every plan's limit map through `resolvePlanLimits`. */
export function resolveLimitsMatrix(
  config: Partial<TEntitlementLimitsConfig> | undefined,
  entitlements: TEntitlementOverride[],
): TEntitlementLimitsMatrix {
  const matrix = {} as TEntitlementLimitsMatrix;
  for (const plan of ENTITLEMENT_PLAN_KEYS) {
    matrix[plan] = resolvePlanLimits(config, entitlements, plan);
  }
  return matrix;
}

export function createEntitlementService(deps: EntitlementServiceDeps): EntitlementService {
  async function resolveEntitlements(params: {
    config?: Partial<TEntitlementLimitsConfig>;
    organizationId?: string;
  }): Promise<TEntitlementLimitsMatrix> {
    const entitlements = await deps.store.listPlanEntitlements(params.organizationId);
    return resolveLimitsMatrix(params.config, entitlements);
  }

  async function setEntitlement(input: Parameters<EntitlementService['setEntitlement']>[0]) {
    return await deps.store.upsertPlanEntitlement(input);
  }

  return { resolveEntitlements, setEntitlement };
}
