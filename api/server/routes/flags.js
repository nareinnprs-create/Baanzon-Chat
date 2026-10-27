const express = require('express');
const { createFlagHandlers, createFlagService } = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { flagsLimiter } = require('~/server/middleware/limiters/flagsLimiter');
const db = require('~/models');

const router = express.Router();

const handlers = createFlagHandlers({
  service: createFlagService({
    store: {
      listFlagOverrides: db.listFlagOverrides,
      upsertFlagOverride: db.upsertFlagOverride,
    },
  }),
  access: {
    getOrganization: db.getOrganization,
    getMembership: db.getMembership,
  },
});

router.use(requireJwtAuth);
router.use(flagsLimiter);

router.get('/', handlers.getFlags);
router.put('/:key', handlers.setFlag);

module.exports = router;
