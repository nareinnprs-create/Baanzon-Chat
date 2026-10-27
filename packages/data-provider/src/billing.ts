import { z } from 'zod';

/**
 * The billing plan tiers an entitlement row can address. Mirrors the
 * `SubscriptionPlan` union in `@librechat/data-schemas` (kept duplicated here
 * so the client carries no data-schemas dependency).
 */
export const ENTITLEMENT_PLAN_KEYS = ['free', 'basic', 'pro', 'enterprise'] as const;

export type TEntitlementPlan = (typeof ENTITLEMENT_PLAN_KEYS)[number];

/**
 * The closed limit registry (blueprint §56 track list, "Model usage" folded
 * into `tokens`). A new tracked resource is a code change here, so stale
 * stored rows stay inert instead of surfacing unknown keys to callers.
 */
export const ENTITLEMENT_RESOURCE_KEYS = [
  'tokens',
  'storage',
  'voice',
  'media',
  'search',
  'agentCompute',
  'workflowExecutions',
] as const;

export type TEntitlementResource = (typeof ENTITLEMENT_RESOURCE_KEYS)[number];

/**
 * A limit at or below this value means "no cap". Enforcement defaults to it,
 * which reproduces today's behavior: nothing is limited until a plan says so.
 */
export const UNLIMITED_LIMIT = -1;

/** Resolved numeric limits for one plan; every resource is always present. */
export type TPlanLimits = Record<TEntitlementResource, number>;

/** The full per-plan matrix `GET /api/billing/entitlements` resolves. */
export type TEntitlementLimitsMatrix = Record<TEntitlementPlan, TPlanLimits>;

/** Override scopes: `global` covers the whole deployment, `organization` one org. */
export const ENTITLEMENT_SCOPES = ['global', 'organization'] as const;

export type TEntitlementScope = (typeof ENTITLEMENT_SCOPES)[number];

/** A stored entitlement row, scoped like a feature-flag override. */
export type TEntitlementOverride = {
  plan: TEntitlementPlan | string;
  resource: TEntitlementResource | string;
  scope: TEntitlementScope;
  scopeId?: string | null;
  limit: number;
};

/**
 * Ship defaults - every plan, every resource unlimited, so an untouched
 * deployment behaves exactly as before entitlements existed. Config levers
 * (`baanzon.yaml billing.limits`) and DB overrides layer on top of this.
 */
export const PLAN_LIMIT_DEFAULTS: TEntitlementLimitsMatrix = ENTITLEMENT_PLAN_KEYS.reduce(
  (matrix, plan) => {
    matrix[plan] = ENTITLEMENT_RESOURCE_KEYS.reduce((limits, resource) => {
      limits[resource] = UNLIMITED_LIMIT;
      return limits;
    }, {} as TPlanLimits);
    return matrix;
  },
  {} as TEntitlementLimitsMatrix,
);

/** One plan's limit levers; omitted resources stay unlimited. */
export const planLimitsEntrySchema = z
  .object({
    tokens: z.number().int().min(UNLIMITED_LIMIT).optional(),
    storage: z.number().int().min(UNLIMITED_LIMIT).optional(),
    voice: z.number().int().min(UNLIMITED_LIMIT).optional(),
    media: z.number().int().min(UNLIMITED_LIMIT).optional(),
    search: z.number().int().min(UNLIMITED_LIMIT).optional(),
    agentCompute: z.number().int().min(UNLIMITED_LIMIT).optional(),
    workflowExecutions: z.number().int().min(UNLIMITED_LIMIT).optional(),
  })
  .strict();

export type TPlanLimitsConfig = z.infer<typeof planLimitsEntrySchema>;

/** `billing.limits` (baanzon.yaml): per-plan limit levers. */
export const planLimitsConfigSchema = z
  .object({
    free: planLimitsEntrySchema.optional(),
    basic: planLimitsEntrySchema.optional(),
    pro: planLimitsEntrySchema.optional(),
    enterprise: planLimitsEntrySchema.optional(),
  })
  .strict();

export type TEntitlementLimitsConfig = z.infer<typeof planLimitsConfigSchema>;

/** `billing` levers (baanzon.yaml). Optional on `configSchema` — an absent block is unlimited. */
export const billingConfigSchema = z
  .object({
    limits: planLimitsConfigSchema.optional(),
  })
  .strict();

export type BillingConfig = z.infer<typeof billingConfigSchema>;

/** `GET /api/billing/entitlements` response - the matrix resolved for the caller. */
export type TGetEntitlementsResponse = {
  entitlements: TEntitlementLimitsMatrix;
};

/** `PUT /api/billing/entitlements/:plan/:resource` body. */
export type TSetEntitlementRequest = {
  limit: number;
  scope?: TEntitlementScope;
  scopeId?: string;
};
