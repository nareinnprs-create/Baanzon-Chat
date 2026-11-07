const express = require('express');
const {
  createEvalHandlers,
  createEvalService,
  createNoTransportEvalInvokers,
} = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { evalsLimiter } = require('~/server/middleware/limiters/evalsLimiter');
const db = require('~/models');

const router = express.Router();

// A7.5: no clean agent/workflow transport is injectable yet (executeAgentRun and
// the trigger actors are transport-coupled), so runs are driven to `failed` with
// a `no transport` error until a real invoker lands. The service, store and
// scoring are live end to end.
const handlers = createEvalHandlers({
  service: createEvalService({
    store: {
      createEvalRun: db.createEvalRun,
      updateEvalRunResult: db.updateEvalRunResult,
      getEvalRunById: db.getEvalRunById,
      listEvalRuns: db.listEvalRuns,
    },
    invokers: createNoTransportEvalInvokers(),
  }),
});

router.use(requireJwtAuth);
router.use(evalsLimiter);

router.post('/runs', handlers.createRun);
router.get('/runs', handlers.listRuns);
router.get('/runs/:id', handlers.getRun);

module.exports = router;
