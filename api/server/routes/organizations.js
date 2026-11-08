const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const { handlers } = require('~/server/services/Organizations/handlers');

const router = express.Router();

router.use(requireJwtAuth);

router.get('/', handlers.list);
router.post('/', handlers.create);
router.get('/:organizationId', handlers.get);
router.patch('/:organizationId', handlers.update);
router.delete('/:organizationId', handlers.delete);
router.get('/:organizationId/members', handlers.listMembers);
router.post('/:organizationId/members', handlers.addMember);
router.patch('/:organizationId/members/:userId', handlers.updateMember);
router.delete('/:organizationId/members/:userId', handlers.removeMember);

module.exports = router;
