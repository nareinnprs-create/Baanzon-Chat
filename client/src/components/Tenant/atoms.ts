import { atom } from 'jotai';
import type {
  TenantDirectory,
  TenantLevel,
  TenantSelection,
  TenantSeed,
} from '~/utils/tenant/types';
import {
  EMPTY_TENANT_SELECTION,
  createTenantDirectory,
  projectsForWorkspace,
  reconcileSelection,
  withOrganization,
  withProject,
  withWorkspace,
  workspacesForOrganization,
} from '~/utils/tenant/tree';

/**
 * Feature-owned Jotai state for the tenant hierarchy.
 *
 * The switcher writes the loaded directory and the current scope, and the rest
 * of the app reads both to decide what it is looking at, so this state belongs
 * to the feature rather than to `~/store`. Nothing is persisted here: a scope
 * arrives as a prop (`initialSelection`) or through {@link seedTenantAtom}, and
 * a host that wants it remembered does the remembering itself. Mount the
 * switcher under its own `<Provider>` (it does this by default) or hand it a
 * shared store through the `store` prop.
 */

/** The loaded lists plus load lifecycle; every lens below reads from here. */
export const tenantDirectoryAtom = atom<TenantDirectory>(createTenantDirectory());

/** The current scope: which organization, workspace and project are picked. */
export const tenantSelectionAtom = atom<TenantSelection>(EMPTY_TENANT_SELECTION);

/* -------------------------------------------------------------- loaded lists */

export const tenantOrganizationsAtom = atom((get) => get(tenantDirectoryAtom).organizations);
export const tenantWorkspacesAtom = atom((get) => get(tenantDirectoryAtom).workspaces);
export const tenantProjectsAtom = atom((get) => get(tenantDirectoryAtom).projects);
export const tenantStatusAtom = atom((get) => get(tenantDirectoryAtom).status);
export const tenantErrorAtom = atom((get) => get(tenantDirectoryAtom).error);

/* ----------------------------------------------------------- current selection */

export const tenantOrganizationIdAtom = atom((get) => get(tenantSelectionAtom).organizationId);
export const tenantWorkspaceIdAtom = atom((get) => get(tenantSelectionAtom).workspaceId);
export const tenantProjectIdAtom = atom((get) => get(tenantSelectionAtom).projectId);

/* ------------------------------------------------------------ cascade lenses */

/**
 * The workspaces selectable right now. Empty until an organization is chosen,
 * because a workspace is meaningless without its parent — that is what makes
 * the cascade rather than three independent pickers.
 */
export const tenantAvailableWorkspacesAtom = atom((get) =>
  workspacesForOrganization(
    get(tenantDirectoryAtom).workspaces,
    get(tenantSelectionAtom).organizationId,
  ),
);

/** The projects selectable right now, under the chosen workspace. */
export const tenantAvailableProjectsAtom = atom((get) =>
  projectsForWorkspace(get(tenantDirectoryAtom).projects, get(tenantSelectionAtom).workspaceId),
);

/** Whether a workspace can be picked at all: an organization has to be chosen. */
export const tenantCanSelectWorkspaceAtom = atom(
  (get) => get(tenantSelectionAtom).organizationId != null,
);

/** Whether a project can be picked at all: a workspace has to be chosen. */
export const tenantCanSelectProjectAtom = atom(
  (get) => get(tenantSelectionAtom).workspaceId != null,
);

/** The deepest level the current scope reaches; `'organization'` at the root. */
export const tenantScopeAtom = atom((get): TenantLevel => {
  const selection = get(tenantSelectionAtom);
  if (selection.projectId != null) {
    return 'projectId';
  }
  if (selection.workspaceId != null) {
    return 'workspaceId';
  }
  return 'organizationId';
});

/* -------------------------------------------------------------------- writes */

/**
 * Merges freshly loaded lists and lifecycle into the directory, then drops any
 * selection the new lists can no longer honour. This is the only writer of the
 * directory: the switcher mirrors its props in here on every render, and a host
 * that owns its own fetching can set it directly instead.
 */
export const setTenantDirectoryAtom = atom(null, (get, set, next: Partial<TenantDirectory>) => {
  const directory = createTenantDirectory({ ...get(tenantDirectoryAtom), ...next });
  set(tenantDirectoryAtom, directory);
  set(tenantSelectionAtom, reconcileSelection(get(tenantSelectionAtom), directory));
});

/**
 * Seeds the feature from a prop or a setter. Split from
 * {@link setTenantDirectoryAtom} because a host passing `initialSelection` must
 * be able to open on a remembered scope before any list has arrived, and
 * reconciliation would discard it against the still-empty directory.
 */
export const seedTenantAtom = atom(null, (_get, set, seed: TenantSeed) => {
  set(tenantDirectoryAtom, createTenantDirectory(seed.directory));
  set(tenantSelectionAtom, {
    ...EMPTY_TENANT_SELECTION,
    ...seed.selection,
  });
});

/** Picks an organization and resets the workspace and project below it. */
export const selectTenantOrganizationAtom = atom(
  null,
  (get, set, organizationId: string | null) => {
    set(tenantSelectionAtom, withOrganization(get(tenantSelectionAtom), organizationId));
  },
);

/** Picks a workspace and resets the project below it. */
export const selectTenantWorkspaceAtom = atom(null, (get, set, workspaceId: string | null) => {
  set(tenantSelectionAtom, withWorkspace(get(tenantSelectionAtom), workspaceId));
});

/** Picks a project; nothing sits below it. */
export const selectTenantProjectAtom = atom(null, (get, set, projectId: string | null) => {
  set(tenantSelectionAtom, withProject(get(tenantSelectionAtom), projectId));
});

/** Clears the scope back to the unscoped root, keeping the loaded lists. */
export const resetTenantAtom = atom(null, (_get, set) => {
  set(tenantSelectionAtom, EMPTY_TENANT_SELECTION);
});
