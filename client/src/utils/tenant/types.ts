/**
 * The plain-object shapes behind the P7 tenant hierarchy: an organization owns
 * workspaces, a workspace owns projects, and the current pick at each level is
 * the scope the rest of the app reads.
 *
 * These are deliberately structural rather than database types. The client must
 * never name a Mongoose `ObjectId` (see AGENTS.md, "Module boundaries"), so
 * ids are plain strings and every extra field the backend sends is carried by
 * an index signature instead of being pinned here. A transport adapter maps
 * whatever the endpoint returns onto these three interfaces; nothing in the
 * feature knows a URL.
 *
 * They live under `utils/` rather than beside the switcher because the cascade
 * arithmetic in `./tree` needs them too, and a util that imports from a
 * component inverts the dependency direction of the feature.
 */

/** Fields every tenant entity carries. Extra fields are passed through untouched. */
interface TenantEntityBase {
  /** Stable identifier, serialized as a string on both sides of the wire. */
  id: string;
  /** Display name, already localized by the backend when it stores one. */
  name: string;
  /** URL-safe handle, when the entity has one. Not used for cascade lookups. */
  slug?: string;
  [key: string]: unknown;
}

/** The root of the hierarchy. */
export type TenantOrganization = TenantEntityBase;

/** A workspace, owned by exactly one organization. */
export interface TenantWorkspace extends TenantEntityBase {
  /** The organization this workspace belongs to; drives the cascade. */
  organizationId: string;
}

/** A project, owned by exactly one workspace. */
export interface TenantProject extends TenantEntityBase {
  /** The workspace this project belongs to; drives the cascade. */
  workspaceId: string;
}

/**
 * The current scope. `null` at a level means "not narrowed here", which is a
 * legitimate state — the root is unscoped until the user picks an organization.
 */
export interface TenantSelection {
  organizationId: string | null;
  workspaceId: string | null;
  projectId: string | null;
}

/** Which level of the cascade a value applies to. */
export type TenantLevel = keyof TenantSelection;

/**
 * Load lifecycle for the directory. `ready` means the lists currently held are
 * complete for the current scope; `error` carries a human-readable reason the
 * host chose to surface, which the switcher renders verbatim.
 */
export type TenantLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Everything the feature renders from, in one object. The switcher writes this
 * into `tenantDirectoryAtom` and reads its lenses, so a host may either pass
 * the pieces as props or seed the atoms directly.
 */
export interface TenantDirectory {
  organizations: readonly TenantOrganization[];
  workspaces: readonly TenantWorkspace[];
  projects: readonly TenantProject[];
  status: TenantLoadStatus;
  error: string | null;
}

/**
 * The one seam between the tenant switcher and the backend. The feature calls
 * an injected implementation; it never imports a data-provider hook, a URL or
 * React Query. `loadWorkspaces`/`loadProjects` are level-scoped, and
 * `signal` lets the caller cancel an in-flight read when the cascade moves on.
 */
export interface TenantDirectoryLoader {
  loadOrganizations(signal?: AbortSignal): Promise<readonly TenantOrganization[]>;
  loadWorkspaces(organizationId: string, signal?: AbortSignal): Promise<readonly TenantWorkspace[]>;
  loadProjects(workspaceId: string, signal?: AbortSignal): Promise<readonly TenantProject[]>;
}

/** What a host passes to seed the feature: the starting scope, optionally scoped. */
export interface TenantSeed {
  selection?: Partial<TenantSelection>;
  directory?: Partial<TenantDirectory>;
}
