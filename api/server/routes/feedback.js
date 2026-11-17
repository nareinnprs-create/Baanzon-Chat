const express = require('express');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const configMiddleware = require('~/server/middleware/config/app');
const { handlers } = require('~/server/services/Feedback/handlers');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

router.use(requireJwtAuth);
router.use(configMiddleware);

// Admin triage routes must be registered before /:id, which would otherwise match.
router.get('/admin', requireAdminAccess, handlers.adminList);
router.patch('/admin/:id', requireAdminAccess, handlers.adminUpdate);

router.get('/', handlers.list);
router.post('/', handlers.create);
router.get('/:id', handlers.get);
router.patch('/:id', handlers.update);
router.delete('/:id', handlers.delete);

module.exports = router;
