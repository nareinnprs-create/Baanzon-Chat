import type { MembershipRecord, OrganizationRecord } from '../organizations/types';
import type { WorkspaceAccessGuard, WorkspaceRecord } from './types';
import { meetsRole, resolveOrganizationRole, toIdString } from '../organizations/access';

/** Any refuse reads identically to the caller: denial is the same throw. */
export const WORKSPACE_ACCESS_DENIED = 'Workspace access denied';

/**
 * The storage reads the guard composes. There is no per-workspace membership:
 * belonging to a workspace is an active membership in its organization, so the
 * guard is workspace read + organization read + membership read.
 */
export interface WorkspaceAccessDeps {
  getWorkspace(workspaceId: string): Promise<WorkspaceRecord | null>;
  getOrganization(organizationId: string): Promise<OrganizationRecord | null>;
  getMembership(organizationId: string, userId: string): Promise<MembershipRecord | null>;
}

/**
 * Builds the guard callers inject ahead of every workspace write.
 *
 * The organization owner wins over any membership row, exactly as
 * `resolveOrganizationRole` decides it, and a membership that is not active
 * grants nothing. The requester must hold `member` or above — a viewer may read
 * an organization but not add work, mirroring `createWorkspace`'s gate. A
 * `private` workspace additionally requires its creator or an organization
 * admin, the same rule `canSeeWorkspace` applies.
 *
 * A missing organization, a missing workspace and a missing membership all read
 * the same — thrown to the handler, which answers 403 without confirming that
 * the workspace exists.
 */
export function createWorkspaceAccessAssert(deps: WorkspaceAccessDeps): WorkspaceAccessGuard {
  return async (workspaceId, userId) => {
    if (!workspaceId || !userId) {
      throw new Error(WORKSPACE_ACCESS_DENIED);
    }

    const workspace = await deps.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(WORKSPACE_ACCESS_DENIED);
    }

    const organizationId = toIdString(workspace.organizationId);
    let organization: OrganizationRecord | null = null;
    let membership: MembershipRecord | null = null;
    if (organizationId) {
      /** Neither read needs the other's result, so they go out together. */
      [organization, membership] = await Promise.all([
        deps.getOrganization(organizationId),
        deps.getMembership(organizationId, userId),
      ]);
    }

    if (!organization) {
      throw new Error(WORKSPACE_ACCESS_DENIED);
    }

    const role = resolveOrganizationRole({ organization, membership, userId });
    if (!meetsRole(role, 'member')) {
      throw new Error(WORKSPACE_ACCESS_DENIED);
    }

    const isPrivate = (workspace.visibility ?? 'org') === 'private';
    if (isPrivate && !(meetsRole(role, 'admin') || toIdString(workspace.createdBy) === userId)) {
      throw new Error(WORKSPACE_ACCESS_DENIED);
    }
  };
}
