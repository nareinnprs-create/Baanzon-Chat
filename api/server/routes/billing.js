const express = require('express');
const { createEntitlementHandlers, createEntitlementService } = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { billingLimiter } = require('~/server/middleware/limiters/billingLimiter');
const db = require('~/models');

const router = express.Router();

const handlers = createEntitlementHandlers({
  service: createEntitlementService({
    store: {
      listPlanEntitlements: db.listPlanEntitlements,
      upsertPlanEntitlement: db.upsertPlanEntitlement,
    },
  }),
  access: {
    getOrganization: db.getOrganization,
    getMembership: db.getMembership,
  },
});

router.use(requireJwtAuth);
router.use(billingLimiter);

router.get('/entitlements', handlers.getEntitlements);
router.put('/entitlements/:plan/:resource', handlers.setEntitlement);

module.exports = router;
