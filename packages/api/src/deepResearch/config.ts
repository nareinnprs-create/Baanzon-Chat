import type { TDeepResearchSettings } from 'librechat-data-provider';

/** Defaults reproduce today's behavior when the `deepResearch` config block is absent. */
export const DEEP_RESEARCH_DEFAULTS: TDeepResearchSettings = {
  enabled: true,
};

/**
 * Coerce the raw YAML `deepResearch` block into a fully-populated settings
 * object. AppService does not run the raw block through `configSchema`, so the
 * resolver applies defaults itself and treats anything invalid as absent.
 */
export function resolveDeepResearchSettings(
  raw?: Partial<TDeepResearchSettings> | null,
): TDeepResearchSettings {
  if (raw == null || typeof raw !== 'object') {
    return { ...DEEP_RESEARCH_DEFAULTS };
  }
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEEP_RESEARCH_DEFAULTS.enabled,
  };
}
