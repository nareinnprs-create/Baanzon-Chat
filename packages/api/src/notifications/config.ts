import type { TNotificationsSettings } from 'librechat-data-provider';

/** Defaults reproduce today's behavior when the `notifications` config block is absent. */
export const NOTIFICATIONS_DEFAULTS: TNotificationsSettings = {
  enabled: true,
  realtime: true,
  pollingIntervalMs: 60000,
};

/**
 * Coerce the raw YAML `notifications` block into a fully-populated settings
 * object. AppService does not run the raw block through `configSchema`, so the
 * resolver applies defaults itself and treats anything non-finite/invalid as
 * absent.
 */
export function resolveNotificationsSettings(
  raw?: Partial<TNotificationsSettings> | null,
): TNotificationsSettings {
  if (raw == null || typeof raw !== 'object') {
    return { ...NOTIFICATIONS_DEFAULTS };
  }
  const polling = raw.pollingIntervalMs;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : NOTIFICATIONS_DEFAULTS.enabled,
    realtime: typeof raw.realtime === 'boolean' ? raw.realtime : NOTIFICATIONS_DEFAULTS.realtime,
    pollingIntervalMs:
      typeof polling === 'number' && Number.isFinite(polling) && polling > 0
        ? Math.floor(polling)
        : NOTIFICATIONS_DEFAULTS.pollingIntervalMs,
  };
}
