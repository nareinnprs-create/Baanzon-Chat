const express = require('express');
const { createTrustHandlers, createTrustService } = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { trustLimiter } = require('~/server/middleware/limiters/trustLimiter');

const router = express.Router();

const handlers = createTrustHandlers({
  service: createTrustService(),
});

router.use(requireJwtAuth);
router.use(trustLimiter);

router.get('/:entityType/:id', handlers.getTrust);

module.exports = router;
