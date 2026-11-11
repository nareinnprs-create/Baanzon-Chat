const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const configMiddleware = require('~/server/middleware/config/app');
const { handlers } = require('~/server/services/Workflows/handlers');

const router = express.Router();

router.use(requireJwtAuth);
router.use(configMiddleware);

router.get('/', handlers.list);
router.post('/', handlers.create);
router.get('/runs/:id', handlers.getRun);
router.post('/:id/runs', handlers.startRun);
router.post('/runs/:runId/cancel', handlers.cancelRun);

module.exports = router;
