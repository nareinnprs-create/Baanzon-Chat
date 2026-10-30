import type { TenantDirectory, TenantProject, TenantSelection, TenantWorkspace } from './types';

/**
 * Pure cascade arithmetic for the tenant hierarchy: which children belong under
 * a parent, and what a pick at one level does to the levels below it.
 *
 * None of this touches atoms, React or transport, so the rules that make the
 * hierarchy correct — a workspace outside the selected organization is never
 * selectable, a project cannot outlive its workspace — are stated once and
 * testable without rendering anything.
 */

/** The unscoped root: no organization, no workspace, no project. */
export const EMPTY_TENANT_SELECTION: TenantSelection = Object.freeze({
  organizationId: null,
  workspaceId: null,
  projectId: null,
});

/** A directory with nothing loaded and nothing failed. */
export function createTenantDirectory(directory: Partial<TenantDirectory> = {}): TenantDirectory {
  return {
    organizations: directory.organizations ?? [],
    workspaces: directory.workspaces ?? [],
    projects: directory.projects ?? [],
    status: directory.status ?? 'idle',
    error: directory.error ?? null,
  };
}

/** The workspaces under one organization, in the order they were loaded. */
export function workspacesForOrganization(
  workspaces: readonly TenantWorkspace[],
  organizationId: string | null,
): TenantWorkspace[] {
  if (organizationId == null) {
    return [];
  }
  return workspaces.filter((workspace) => workspace.organizationId === organizationId);
}

/** The projects under one workspace, in the order they were loaded. */
export function projectsForWorkspace(
  projects: readonly TenantProject[],
  workspaceId: string | null,
): TenantProject[] {
  if (workspaceId == null) {
    return [];
  }
  return projects.filter((project) => project.workspaceId === workspaceId);
}

/**
 * Picks an organization and drops everything under the old one.
 *
 * Keeping the previous workspace would leave a scope whose parent no longer
 * matches and the backend would reject it, so the cascade resets here rather
 * than repairing itself on the next render.
 */
export function withOrganization(
  selection: TenantSelection,
  organizationId: string | null,
): TenantSelection {
  if (organizationId === selection.organizationId) {
    return selection;
  }
  return { organizationId, workspaceId: null, projectId: null };
}

/**
 * Picks a workspace, dropping the project that lived under the old one. The
 * organization is kept, because a workspace pick only narrows what is already
 * selected.
 */
export function withWorkspace(
  selection: TenantSelection,
  workspaceId: string | null,
): TenantSelection {
  if (workspaceId === selection.workspaceId) {
    return selection;
  }
  return { ...selection, workspaceId, projectId: null };
}

/** Picks a project. Nothing sits below it, so the levels above are untouched. */
export function withProject(selection: TenantSelection, projectId: string | null): TenantSelection {
  if (projectId === selection.projectId) {
    return selection;
  }
  return { ...selection, projectId };
}

/**
 * Drops ids the loaded directory can no longer honour.
 *
 * A directory is only trusted once it is `ready`: while it is `loading` the
 * lists are partly filled, and reconciling against a partial list would erase a
 * selection that is merely in flight. Called on every directory write so a
 * membership revoked upstream does not leave a scope pointing at a tenant the
 * user can no longer see.
 */
export function reconcileSelection(
  selection: TenantSelection,
  directory: TenantDirectory,
): TenantSelection {
  if (directory.status !== 'ready') {
    return selection;
  }
  const next = { ...selection };
  if (
    next.organizationId != null &&
    !directory.organizations.some((organization) => organization.id === next.organizationId)
  ) {
    return { ...EMPTY_TENANT_SELECTION };
  }
  if (
    next.workspaceId != null &&
    !workspacesForOrganization(directory.workspaces, next.organizationId).some(
      (workspace) => workspace.id === next.workspaceId,
    )
  ) {
    next.workspaceId = null;
  }
  if (
    next.projectId != null &&
    !projectsForWorkspace(directory.projects, next.workspaceId).some(
      (project) => project.id === next.projectId,
    )
  ) {
    next.projectId = null;
  }
  return next;
}
