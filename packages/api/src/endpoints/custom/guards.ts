import { logger } from '@librechat/data-schemas';
import { EModelEndpoint } from 'librechat-data-provider';
import { customEndpointsDefaults } from 'librechat-data-provider';
import type { TEndpoint, TCustomConfig } from 'librechat-data-provider';

export type CustomEndpointsLeverConfig = TCustomConfig['customEndpoints'];

export interface AppliedCustomEndpointsLevers {
  enabled: boolean;
  maxUpstreams: number;
  /** Present when `maxUpstreams` clamped the configured count. */
  clampedFrom?: number;
}

/**
 * Resolves the admin `customEndpoints` levers against defaults that preserve
 * current behavior (enabled, uncapped at 8). Rejects non-positive integers
 * defensively so a malformed override cannot disable the coercion entirely.
 */
export function resolveCustomEndpointsLevers(
  config?: CustomEndpointsLeverConfig | null,
): AppliedCustomEndpointsLevers {
  const enabled = config?.enabled ?? customEndpointsDefaults.enabled;
  let resolvedMax = config?.maxUpstreams ?? customEndpointsDefaults.maxUpstreams;
  if (!Number.isInteger(resolvedMax) || resolvedMax <= 0) {
    logger.warn(
      `[customEndpoints] Ignoring invalid maxUpstreams: ${String(config?.maxUpstreams)} — using ${customEndpointsDefaults.maxUpstreams}`,
    );
    resolvedMax = customEndpointsDefaults.maxUpstreams;
  }
  return { enabled, maxUpstreams: resolvedMax };
}

/**
 * Applies the `customEndpoints` config levers to the raw configured list:
 * `enabled: false` turns the whole block off, and `maxUpstreams` caps how
 * many upstreams survive (trimmed in configured order). All-or-nothing power
 * state means a disabled deploy behaves exactly as if `endpoints.custom`
 * were absent from `baanzon.yaml`.
 */
export function filterCustomEndpoints(
  customEndpoints: unknown,
  config?: CustomEndpointsLeverConfig | null,
): { endpoints: TEndpoint[]; levers: AppliedCustomEndpointsLevers } {
  const levers = resolveCustomEndpointsLevers(config);
  if (!levers.enabled || !Array.isArray(customEndpoints)) {
    return { endpoints: [], levers };
  }
  if (customEndpoints.length > levers.maxUpstreams) {
    logger.warn(
      `[customEndpoints] ${customEndpoints.length} upstreams configured; keeping the first ${levers.maxUpstreams} (maxUpstreams)`,
    );
    return {
      endpoints: (customEndpoints as TEndpoint[]).slice(0, levers.maxUpstreams),
      levers: { ...levers, clampedFrom: customEndpoints.length },
    };
  }
  return { endpoints: customEndpoints as TEndpoint[], levers };
}

/**
 * Convenience wrapper reading the levers straight from an `AppConfig`.
 */
export function applyCustomEndpointsLevers(config?: {
  config?: Pick<TCustomConfig, 'customEndpoints'> | null;
  endpoints?: { [EModelEndpoint.custom]?: unknown } | null;
}): { endpoints: TEndpoint[]; levers: AppliedCustomEndpointsLevers } {
  return filterCustomEndpoints(config?.endpoints?.[EModelEndpoint.custom], config?.config?.customEndpoints);
}
