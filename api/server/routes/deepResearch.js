const express = require('express');
const { createDeepResearchHandlers, createDeepResearchRunner } = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { projectsLimiter } = require('~/server/middleware/limiters');

const router = express.Router();

/**
 * Search and the LLM arrive injected; until a provider is wired the runner
 * degrades gracefully (explanatory `search_unsupported` event, deterministic
 * summary), so the flow stays usable instead of erroring on an unconfigured
 * backend. The `deepResearch.enabled` lever is resolved inside the handlers.
 */
const handlers = createDeepResearchHandlers({ runner: createDeepResearchRunner({}) });

router.use(requireJwtAuth);
router.use(projectsLimiter);

router.post('/plan', handlers.createPlan);
router.get('/run', handlers.runStep);
router.post('/report', handlers.buildReport);

module.exports = router;
