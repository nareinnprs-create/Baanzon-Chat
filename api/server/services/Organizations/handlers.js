const { createOrganizationHandlers } = require('@librechat/api');
const {
  createOrganization,
  getOrganization,
  listOrganizationsForUser,
  updateOrganization,
  deleteOrganization,
  getMembership,
  listOrganizationMemberships,
  addMembership,
  updateMembership,
  removeMembership,
} = require('~/models');

const handlers = createOrganizationHandlers({
  createOrganization,
  getOrganization,
  listOrganizationsForUser,
  updateOrganization,
  deleteOrganization,
  getMembership,
  listOrganizationMemberships,
  addMembership,
  updateMembership,
  removeMembership,
});

module.exports = { handlers };
