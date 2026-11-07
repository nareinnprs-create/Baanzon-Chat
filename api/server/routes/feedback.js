const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const configMiddleware = require('~/server/middleware/config/app');
const { handlers } = require('~/server/services/Feedback/handlers');

const router = express.Router();

router.use(requireJwtAuth);
router.use(configMiddleware);

router.get('/', handlers.list);
router.post('/', handlers.create);
router.get('/:id', handlers.get);
router.patch('/:id', handlers.update);
router.delete('/:id', handlers.delete);

module.exports = router;
