const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const { handlers } = require('~/server/services/Workspaces/handlers');

const router = express.Router();

router.use(requireJwtAuth);

router.get('/', handlers.list);
router.post('/', handlers.create);
router.get('/:workspaceId', handlers.get);
router.patch('/:workspaceId', handlers.update);
router.delete('/:workspaceId', handlers.delete);

module.exports = router;
