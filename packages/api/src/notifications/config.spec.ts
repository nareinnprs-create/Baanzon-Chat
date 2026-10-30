import { NOTIFICATIONS_DEFAULTS, resolveNotificationsSettings } from './config';

describe('resolveNotificationsSettings', () => {
  it('returns the defaults when no block is provided', () => {
    expect(resolveNotificationsSettings(undefined)).toEqual(NOTIFICATIONS_DEFAULTS);
    expect(resolveNotificationsSettings(null)).toEqual(NOTIFICATIONS_DEFAULTS);
  });

  it('honors explicit booleans and floors a positive interval', () => {
    expect(
      resolveNotificationsSettings({ enabled: false, realtime: false, pollingIntervalMs: 1500.9 }),
    ).toEqual({ enabled: false, realtime: false, pollingIntervalMs: 1500 });
  });

  it('falls back per-field for invalid values', () => {
    expect(
      resolveNotificationsSettings({
        enabled: 'yes' as unknown as boolean,
        realtime: 1 as unknown as boolean,
        pollingIntervalMs: -5,
      }),
    ).toEqual(NOTIFICATIONS_DEFAULTS);

    expect(resolveNotificationsSettings({ pollingIntervalMs: 0 })).toEqual(NOTIFICATIONS_DEFAULTS);
    expect(resolveNotificationsSettings({ pollingIntervalMs: NaN })).toEqual(
      NOTIFICATIONS_DEFAULTS,
    );
  });

  it('does not mutate the shared defaults', () => {
    const settings = resolveNotificationsSettings({ enabled: false });
    settings.pollingIntervalMs = 1;
    expect(NOTIFICATIONS_DEFAULTS.pollingIntervalMs).toBe(60000);
  });
});
