const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const configMiddleware = require('~/server/middleware/config/app');
const { pushHandlers } = require('~/server/services/Push/handlers');

const router = express.Router();

router.use(requireJwtAuth);
router.use(configMiddleware);

router.get('/', pushHandlers.getPushConfig);
router.post('/subscribe', pushHandlers.subscribe);
router.post('/unsubscribe', pushHandlers.unsubscribe);

module.exports = router;
