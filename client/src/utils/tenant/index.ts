/**
 * Cascade arithmetic and entity shapes for the tenant hierarchy.
 *
 * `utils/` rather than the feature folder: the rules here are pure functions
 * over plain objects, so they are testable without rendering anything and
 * reusable by whatever else needs to reason about the scope.
 */

export {
  EMPTY_TENANT_SELECTION,
  createTenantDirectory,
  projectsForWorkspace,
  reconcileSelection,
  withOrganization,
  withProject,
  withWorkspace,
  workspacesForOrganization,
} from './tree';
export type {
  TenantDirectory,
  TenantDirectoryLoader,
  TenantLevel,
  TenantLoadStatus,
  TenantOrganization,
  TenantProject,
  TenantSeed,
  TenantSelection,
  TenantWorkspace,
} from './types';
