/**
 * Tenant switcher — the client half of the P7 organization → workspace →
 * project hierarchy.
 *
 * The feature owns no transport and no persistence. Loaded lists and the load
 * lifecycle arrive as props, the current scope is seeded from
 * `initialSelection` and handed back through `onChange`, and the one seam to
 * the backend is the `TenantDirectoryLoader` interface the host implements.
 * Feature state lives in the Jotai atoms under `./atoms`, the cascade arithmetic
 * and entity shapes in `~/utils/tenant`, and the transport seam in
 * `~/hooks/useTenantDirectory`.
 *
 * ## Mounting
 *
 * ```tsx
 * import { TenantSwitcher } from '~/components/Tenant';
 * import { useTenantDirectory } from '~/hooks/useTenantDirectory';
 *
 * function TenantScopeSlot({ selection, onChange }: Props) {
 *   const directory = useTenantDirectory({ loader, selection });
 *   return (
 *     <TenantSwitcher
 *       {...directory}
 *       initialSelection={selection}
 *       onChange={onChange}
 *       onRetry={directory.reload}
 *     />
 *   );
 * }
 * ```
 *
 * `TenantSwitcher` owns one Jotai store per instance and seeds it from
 * `initialSelection`, so nothing needs to be provided to render it. To read the
 * same scope from elsewhere in the tree — a sidebar breadcrumb, a route guard —
 * pass a store through the `store` prop and put both readers under your own
 * `<Provider store={thatStore}>`; the feature atoms (`tenantSelectionAtom`,
 * `tenantDirectoryAtom`) then describe what every reader sees. A passed store is
 * seeded from `initialSelection` on first use and never re-seeded after that, so
 * a reader cannot clobber the picks the switcher has already published. Passing
 * both `store` and the bare atoms works too, as long as the atoms are read under
 * a provider bound to that same store.
 *
 * The switcher is not mounted anywhere in this wave. Routes and the sidebar are
 * owned elsewhere; import it from this barrel when they are ready.
 */

export { default as TenantSwitcher } from './TenantSwitcher';
export {
  resetTenantAtom,
  seedTenantAtom,
  selectTenantOrganizationAtom,
  selectTenantProjectAtom,
  selectTenantWorkspaceAtom,
  setTenantDirectoryAtom,
  tenantAvailableProjectsAtom,
  tenantAvailableWorkspacesAtom,
  tenantCanSelectProjectAtom,
  tenantCanSelectWorkspaceAtom,
  tenantDirectoryAtom,
  tenantErrorAtom,
  tenantOrganizationIdAtom,
  tenantOrganizationsAtom,
  tenantProjectIdAtom,
  tenantProjectsAtom,
  tenantScopeAtom,
  tenantSelectionAtom,
  tenantStatusAtom,
  tenantWorkspaceIdAtom,
  tenantWorkspacesAtom,
} from './atoms';
export {
  EMPTY_TENANT_SELECTION,
  createTenantDirectory,
  projectsForWorkspace,
  reconcileSelection,
  withOrganization,
  withProject,
  withWorkspace,
  workspacesForOrganization,
} from '~/utils/tenant/tree';
export type { TenantSwitcherProps, TenantStore } from './TenantSwitcher';
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
} from '~/utils/tenant/types';
export type { TenantDirectoryState, UseTenantDirectoryOptions } from '~/hooks/useTenantDirectory';
