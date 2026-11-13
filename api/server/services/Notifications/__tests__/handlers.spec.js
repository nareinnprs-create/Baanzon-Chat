/**
 * Wiring test for the notifications seam: the process-wide service must carry
 * the fire-and-forget push hook exactly when web push is configured, so every
 * notification creator (REST handler or background producer) fans out to push
 * through the single onCreated seam.
 */
jest.mock('@librechat/api', () => ({
  createNotificationsService: jest.fn(() => ({ create: jest.fn() })),
  createNotificationStreamHub: jest.fn(() => ({
    subscribe: jest.fn(),
    publish: jest.fn(),
  })),
  createNotificationsHandlers: jest.fn(() => ({ list: jest.fn() })),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), warn: jest.fn() },
}));

jest.mock('~/models', () => ({
  createNotification: jest.fn(),
  listNotifications: jest.fn(),
  countUnreadNotifications: jest.fn(),
  markNotificationRead: jest.fn(),
  markAllNotificationsRead: jest.fn(),
  deleteNotification: jest.fn(),
}));

const pushWiring = { dispatcher: null, configured: false };

jest.mock('~/server/services/Push/handlers', () => ({
  get dispatcher() {
    return pushWiring.dispatcher;
  },
  get configured() {
    return pushWiring.configured;
  },
}));

function loadWired() {
  jest.resetModules();
  return {
    api: require('@librechat/api'),
    logger: require('@librechat/data-schemas').logger,
    handlers: require('~/server/services/Notifications/handlers'),
  };
}

describe('Notifications handlers push seam', () => {
  const ORIGINAL_ENV = { ...process.env };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    process.env.VAPID_PUBLIC_KEY = 'pub-key';
    process.env.VAPID_PRIVATE_KEY = 'priv-key';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('wires an onCreated hook that dispatches push fire-and-forget', async () => {
    pushWiring.configured = true;
    pushWiring.dispatcher = { dispatch: jest.fn().mockResolvedValue(1) };

    const { api } = loadWired();

    expect(api.createNotificationsService).toHaveBeenCalledWith(
      expect.objectContaining({ onCreated: expect.any(Function) }),
    );
    const { onCreated } = api.createNotificationsService.mock.calls[0][0];

    onCreated('user-1', { title: 'Done', body: 'Run finished', link: '/c/abc' });
    await flush();

    expect(pushWiring.dispatcher.dispatch).toHaveBeenCalledWith('user-1', {
      title: 'Done',
      body: 'Run finished',
      link: '/c/abc',
    });
  });

  it('survives a rejecting dispatch without propagating the error', async () => {
    pushWiring.configured = true;
    pushWiring.dispatcher = { dispatch: jest.fn().mockRejectedValue(new Error('boom')) };

    const { api, logger } = loadWired();
    const { onCreated } = api.createNotificationsService.mock.calls[0][0];

    expect(() => onCreated('user-1', { title: 'x' })).not.toThrow();
    await flush();

    expect(logger.error).toHaveBeenCalledWith('[push] Dispatch error:', expect.any(Error));
  });

  it('omits the onCreated hook when push is not configured', () => {
    pushWiring.configured = false;
    pushWiring.dispatcher = null;

    const { api } = loadWired();

    expect(api.createNotificationsService).toHaveBeenCalledWith(
      expect.objectContaining({ onCreated: undefined }),
    );
  });
});
