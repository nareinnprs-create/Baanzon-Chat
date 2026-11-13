const {
  createNotificationsService,
  createNotificationStreamHub,
  createNotificationsHandlers,
} = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const {
  createNotification,
  listNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} = require('~/models');
const {
  dispatcher: pushDispatcher,
  configured: pushConfigured,
} = require('~/server/services/Push/handlers');

/**
 * The hub is process-scoped: every request shares the one fan-out registry so a
 * background run's `publish` reaches any stream this process holds open.
 */
const hub = createNotificationStreamHub();

const service = createNotificationsService({
  notifications: {
    createNotification,
    listNotifications,
    countUnreadNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification,
  },
  // Fire-and-forget web push for every notification (REST + producer seam).
  onCreated:
    pushConfigured && pushDispatcher
      ? (userId, notification) => {
          pushDispatcher
            .dispatch(userId, {
              title: notification.title,
              body: notification.body,
              link: notification.link,
            })
            .catch((err) => logger.error('[push] Dispatch error:', err));
        }
      : undefined,
});

const handlers = createNotificationsHandlers({ service, hub });

module.exports = { handlers, hub, service };
