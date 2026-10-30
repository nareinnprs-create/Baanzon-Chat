const express = require('express');
const { MeiliSearch } = require('meilisearch');
const { isEnabled, runRecall } = require('@librechat/api');
const { requireJwtAuth } = require('~/server/middleware');
const { recallLimiter } = require('~/server/middleware/limiters/recallLimiter');
const db = require('~/models');

const router = express.Router();

/** Same gates as the mongoMeili plugin: search on, Meili reachable. */
const search =
  isEnabled(process.env.SEARCH) && process.env.MEILI_HOST && process.env.MEILI_MASTER_KEY
    ? (() => {
        const client = new MeiliSearch({
          host: process.env.MEILI_HOST,
          apiKey: process.env.MEILI_MASTER_KEY,
        });
        return (index, q, params) => client.index(index).search(q, params);
      })()
    : null;

/** Batched, user-scoped hydration of title/updatedAt from Mongo. */
const getConvoMap = async (userId, conversationIds) => {
  const { convoMap } = await db.getConvosQueried(
    userId,
    conversationIds.map((conversationId) => ({ conversationId })),
    null,
    conversationIds.length,
  );
  return convoMap;
};

router.get('/', requireJwtAuth, recallLimiter, async (req, res) => {
  const { status, body } = await runRecall({
    query: req.query.q,
    userId: req.user?.id,
    search,
    getConvoMap,
  });
  return res.status(status).json(body);
});

module.exports = router;
