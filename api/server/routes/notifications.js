const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const configMiddleware = require('~/server/middleware/config/app');
const { handlers } = require('~/server/services/Notifications/handlers');

const router = express.Router();

router.use(requireJwtAuth);
router.use(configMiddleware);

/**
 * `/stream` and the fixed sub-paths are registered before the `/:id` routes so
 * they are not captured as an id segment.
 */
router.get('/stream', handlers.stream);
router.get('/unread-count', handlers.getUnreadCount);
router.post('/read-all', handlers.markAllRead);
router.get('/', handlers.listNotifications);
router.post('/', handlers.createNotification);
router.post('/:id/read', handlers.markRead);
router.delete('/:id', handlers.deleteNotification);

module.exports = router;
