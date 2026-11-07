const {
  createNotificationsService,
  createNotificationStreamHub,
  createNotificationsHandlers,
} = require('@librechat/api');
const {
  createNotification,
  listNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} = require('~/models');

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
});

const handlers = createNotificationsHandlers({ service, hub });

module.exports = { handlers, hub, service };
