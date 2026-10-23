const express = require('express');
const { createProjectHandlers, createWorkspaceAccessAssert } = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { projectsLimiter } = require('~/server/middleware/limiters/projectsLimiter');
const db = require('~/models');

const router = express.Router();
const handlers = createProjectHandlers({
  listChatProjects: db.listChatProjects,
  createChatProject: db.createChatProject,
  getChatProject: db.getChatProject,
  updateChatProject: db.updateChatProject,
  deleteChatProject: db.deleteChatProject,
  assignConversationToProject: db.assignConversationToProject,
  assertWorkspaceAccess: createWorkspaceAccessAssert({
    getWorkspace: db.getWorkspace,
    getOrganization: db.getOrganization,
    getMembership: db.getMembership,
  }),
});

router.use(requireJwtAuth);
router.use(projectsLimiter);

router.get('/', handlers.listProjects);
router.post('/', handlers.createProject);
router.put('/conversations/:conversationId', handlers.assignConversationToProject);
router.get('/:projectId', handlers.getProject);
router.patch('/:projectId', handlers.updateProject);
router.delete('/:projectId', handlers.deleteProject);

module.exports = router;
