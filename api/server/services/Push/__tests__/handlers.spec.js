/**
 * Wiring test for the web-push adapter: with VAPID env vars set, the module
 * configures web-push, builds a dispatcher and exposes enabled handlers;
 * without them, handlers still exist but the feature reports as off.
 */
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

jest.mock('@librechat/api', () => ({
  createPushDispatcher: jest.fn(() => ({ dispatch: jest.fn() })),
  createPushHandlers: jest.fn(() => ({ getPushConfig: jest.fn() })),
}));

jest.mock('~/models', () => ({
  upsertPushSubscription: jest.fn(),
  listPushSubscriptions: jest.fn(),
  deletePushSubscription: jest.fn(),
  deletePushSubscriptionByEndpoint: jest.fn(),
}));

describe('Push handlers wiring', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function loadWired() {
    jest.resetModules();
    return {
      api: require('@librechat/api'),
      webpush: require('web-push'),
      wired: require('~/server/services/Push/handlers'),
    };
  }

  it('wires VAPID details, a dispatcher and the public key when configured', () => {
    process.env.VAPID_PUBLIC_KEY = 'pub-key';
    process.env.VAPID_PRIVATE_KEY = 'priv-key';
    delete process.env.VAPID_SUBJECT;

    const { api, webpush, wired } = loadWired();

    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      'mailto:support@baanzonchat.opraiz.com',
      'pub-key',
      'priv-key',
    );
    expect(api.createPushDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptions: expect.objectContaining({
          upsertPushSubscription: expect.any(Function),
          listPushSubscriptions: expect.any(Function),
          deletePushSubscriptionByEndpoint: expect.any(Function),
        }),
        send: expect.any(Function),
      }),
    );
    expect(api.createPushHandlers).toHaveBeenCalledWith({
      subscriptions: expect.any(Object),
      dispatcher: { dispatch: expect.any(Function) },
      publicKey: 'pub-key',
    });
    expect(wired.configured).toBe(true);
    expect(wired.dispatcher).not.toBeNull();
    expect(wired.pushHandlers).toBeDefined();
  });

  it('exposes inert handlers without any push configuration', () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const { api, webpush, wired } = loadWired();

    expect(webpush.setVapidDetails).not.toHaveBeenCalled();
    expect(api.createPushDispatcher).not.toHaveBeenCalled();
    expect(api.createPushHandlers).toHaveBeenCalledWith({
      subscriptions: expect.any(Object),
    });
    expect(wired.configured).toBe(false);
    expect(wired.dispatcher).toBeNull();
    expect(wired.pushHandlers).toBeDefined();
  });
});
