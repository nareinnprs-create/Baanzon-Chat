const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { requireJwtAuth } = require('~/server/middleware');
const { getMessageUsageSummary } = require('~/models');

const router = express.Router();

/** All-time usage totals for the current user (messages + token sums). */
router.get('/summary', requireJwtAuth, async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id?.toString();
    res.status(200).send(await getMessageUsageSummary(userId));
  } catch (error) {
    logger.error('[usage] Error getting usage summary', error);
    res.status(500).json({ error: 'Error getting usage summary' });
  }
});

module.exports = router;
