const express = require('express');
const { runRewrite } = require('@librechat/api');
const { requireJwtAuth } = require('~/server/middleware');
const { rewriteLimiter } = require('~/server/middleware/limiters/rewriteLimiter');
const db = require('~/models');

const router = express.Router();

router.post('/', requireJwtAuth, rewriteLimiter, async (req, res) => {
  const { status, body } = await runRewrite({
    req,
    db: {
      getUserKey: db.getUserKey,
      getUserKeyValues: db.getUserKeyValues,
      getRecentConversations: (userId, options) => db.getConvosByCursor(userId, options),
    },
  });
  return res.status(status).json(body);
});

module.exports = router;
