const express = require('express');
const { createSearchHandlers } = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { searchLimiter } = require('~/server/middleware/limiters/searchLimiter');
const db = require('~/models');

const router = express.Router();

const handlers = createSearchHandlers({
  store: {
    searchConversationsByTitle: db.searchConversationsByTitle,
    searchChatProjectsByTitle: db.searchChatProjectsByTitle,
  },
});

router.use(requireJwtAuth);
router.use(searchLimiter);

router.get('/', handlers.searchAll);

module.exports = router;
