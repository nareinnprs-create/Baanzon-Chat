import { FEATURE_FLAG_DEFAULTS, FEATURE_FLAG_KEYS } from 'librechat-data-provider';
import type {
  TFeatureFlagKey,
  TFeatureFlagMap,
  TFeatureFlagOverride,
} from 'librechat-data-provider';
import type { FlagService, FlagServiceDeps } from './types';

const knownKeys = new Set<string>(FEATURE_FLAG_KEYS as readonly string[]);

/**
 * Pure resolution: ship defaults, then the baanzon.yaml `featureFlags` levers,
 * then stored overrides. Overrides layer `global` first and `organization`
 * second, so an organization row outranks a global one, which outranks config.
 * Unknown keys anywhere are ignored — a renamed flag leaves stale rows inert
 * instead of surfacing garbage to callers.
 */
export function resolveFlagMap(
  config: Partial<TFeatureFlagMap> | undefined,
  overrides: TFeatureFlagOverride[],
): TFeatureFlagMap {
  const resolved: TFeatureFlagMap = { ...FEATURE_FLAG_DEFAULTS };
  for (const key of FEATURE_FLAG_KEYS) {
    const lever = config?.[key];
    if (typeof lever === 'boolean') {
      resolved[key] = lever;
    }
  }
  const globalRows = overrides.filter((row) => row.scope === 'global');
  const orgRows = overrides.filter((row) => row.scope === 'organization');
  for (const row of [...globalRows, ...orgRows]) {
    if (!knownKeys.has(row.key)) {
      continue;
    }
    resolved[row.key as TFeatureFlagKey] = row.value;
  }
  return resolved;
}

export function createFlagService(deps: FlagServiceDeps): FlagService {
  async function resolveFlags(params: {
    config?: Partial<TFeatureFlagMap>;
    organizationId?: string;
  }): Promise<TFeatureFlagMap> {
    const overrides = await deps.store.listFlagOverrides(params.organizationId);
    return resolveFlagMap(params.config, overrides);
  }

  async function setFlag(input: Parameters<FlagService['setFlag']>[0]) {
    return await deps.store.upsertFlagOverride(input);
  }

  return { resolveFlags, setFlag };
}
