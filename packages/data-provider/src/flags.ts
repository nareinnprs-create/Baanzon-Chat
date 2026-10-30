import { z } from 'zod';

/**
 * The fixed flag registry. Flags are shipped features a deploy can kill, so the
 * set is closed: a new flag is a code change here, not a free-form store key.
 */
export const FEATURE_FLAG_KEYS = [
  'workspace.projects',
  'deepResearch.ui',
  'workflow.builder',
] as const;

export type TFeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

export type TFeatureFlagMap = Record<TFeatureFlagKey, boolean>;

/** Override scopes: `global` covers the whole deployment, `organization` covers one org. */
export type TFeatureFlagScope = 'global' | 'organization';

export const FEATURE_FLAG_SCOPES = ['global', 'organization'] as const;

/**
 * Seed defaults — they reproduce today's behavior: every seeded feature ships
 * enabled until a config lever or a DB override says otherwise.
 */
export const FEATURE_FLAG_DEFAULTS: TFeatureFlagMap = {
  'workspace.projects': true,
  'deepResearch.ui': true,
  'workflow.builder': true,
};

/**
 * Per-name config levers (baanzon.yaml `featureFlags.*`), one entry per flag
 * name. Defaults reproduce today: every flag on.
 */
export const featureFlagsConfigSchema = z
  .object({
    'workspace.projects': z.boolean().default(true),
    'deepResearch.ui': z.boolean().default(true),
    'workflow.builder': z.boolean().default(true),
  })
  .strict()
  /** `featureFlags` itself is optional: all flags default on, matching the
   *  majority of configs that predate the block. */
  .default({ 'workspace.projects': true, 'deepResearch.ui': true, 'workflow.builder': true });

export type FeatureFlagsConfig = z.infer<typeof featureFlagsConfigSchema>;

/** `GET /api/flags` response — the map resolved for the requesting caller. */
export type TFeatureFlagsResponse = {
  flags: TFeatureFlagMap;
};

/** `PUT /api/flags/:key` body. */
export type TSetFeatureFlagRequest = {
  value: boolean;
  scope?: TFeatureFlagScope;
  scopeId?: string;
};

/** A stored override row, scoped. */
export type TFeatureFlagOverride = {
  key: string;
  scope: TFeatureFlagScope;
  scopeId?: string | null;
  value: boolean;
};
