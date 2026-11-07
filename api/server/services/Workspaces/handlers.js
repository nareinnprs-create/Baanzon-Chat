const { createWorkspaceHandlers } = require('@librechat/api');
const {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
  deleteWorkspace,
  getOrganization,
  getMembership,
} = require('~/models');

const handlers = createWorkspaceHandlers({
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
  deleteWorkspace,
  getOrganization,
  getMembership,
});

module.exports = { handlers };
