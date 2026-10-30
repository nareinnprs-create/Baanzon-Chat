const express = require('express');
const { createAdminProvidersHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { getAppConfig } = require('~/server/services/Config');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

const handlers = createAdminProvidersHandlers({ getAppConfig });

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', handlers.listProviders);
router.post('/test', handlers.testProvider);

module.exports = router;
