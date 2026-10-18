import { z } from 'zod';
import { isValidObjectIdString, logger } from '@librechat/data-schemas';
import type { MembershipRole, UpdateWorkspaceInput } from '@librechat/data-schemas';
import type { Response } from 'express';
import type {
  WorkspaceCreateRequest,
  WorkspaceDataSource,
  WorkspaceDTO,
  WorkspaceHandlers,
  WorkspaceRecord,
  WorkspaceUpdateRequest,
} from './types';
import type { OrganizationRecord, MembershipRecord } from '../organizations/types';
import type { ServerRequest } from '~/types';
import {
  matchesTenant,
  meetsRole,
  resolveOrganizationRole,
  toIdString,
  toIso,
} from '../organizations/access';
import { resolveRequestTenantId } from '~/middleware/tenant';
import { queryString } from '~/utils/query';

const createWorkspaceSchema = z.object({
  organizationId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  visibility: z.enum(['private', 'org']).optional(),
});

const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  visibility: z.enum(['private', 'org']).optional(),
});

interface Actor {
  userId: string;
  tenantId?: string;
}

/** A workspace the requester reached, with the authority they hold in its organization. */
interface WorkspaceAccess {
  workspace: WorkspaceRecord;
  role: MembershipRole;
}

const NOT_A_MEMBER = 'Workspace not found';

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return 'Invalid workspace payload';
  }
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function serializeWorkspace(record: WorkspaceRecord): WorkspaceDTO {
  return {
    id: toIdString(record._id),
    organizationId: toIdString(record.organizationId),
    name: record.name,
    slug: record.slug,
    description: record.description,
    visibility: record.visibility ?? 'org',
    createdBy: toIdString(record.createdBy),
    tenantId: record.tenantId,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

/**
 * A `private` workspace is visible to organization admins and to the user who
 * created it; `org` visibility is every active member's. The membership type is
 * organization-scoped, so there is no per-workspace role to consult.
 */
function canSeeWorkspace(
  workspace: WorkspaceRecord,
  role: MembershipRole,
  userId: string,
): boolean {
  if ((workspace.visibility ?? 'org') !== 'private') {
    return true;
  }
  return meetsRole(role, 'admin') || toIdString(workspace.createdBy) === userId;
}

export function createWorkspaceHandlers(deps: WorkspaceDataSource): WorkspaceHandlers {
  function resolveActor(req: ServerRequest, res: Response): Actor | null {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return null;
    }
    return { userId, tenantId: resolveRequestTenantId(req) };
  }

  /**
   * Places an organizationId in the tenant and returns the requester's
   * authority in it. A missing organization, a tenant mismatch and a
   * non-member are the same 404, so membership is never confirmed to an outsider.
   */
  async function resolveOrgAccess(
    organizationId: string,
    res: Response,
    actor: Actor,
  ): Promise<{ organization: OrganizationRecord; role: MembershipRole } | null> {
    if (!isValidObjectIdString(organizationId)) {
      res.status(400).json({ error: 'Invalid organizationId' });
      return null;
    }

    /** Neither read needs the other's result, so they go out together. */
    let organization: OrganizationRecord | null;
    let membership: MembershipRecord | null;
    try {
      [organization, membership] = await Promise.all([
        deps.getOrganization(organizationId),
        deps.getMembership(organizationId, actor.userId),
      ]);
    } catch (error) {
      logger.error('[workspaces] Error loading organization', error);
      res.status(500).json({ error: 'Error loading organization' });
      return null;
    }

    if (!organization || !matchesTenant(organization.tenantId, actor.tenantId)) {
      res.status(404).json({ error: NOT_A_MEMBER });
      return null;
    }

    const role = resolveOrganizationRole({ organization, membership, userId: actor.userId });
    if (!role) {
      res.status(404).json({ error: NOT_A_MEMBER });
      return null;
    }

    return { organization, role };
  }

  /** Loads the workspace in `:workspaceId` with the requester's authority in its organization. */
  async function resolveWorkspaceAccess(
    req: ServerRequest,
    res: Response,
    actor: Actor,
  ): Promise<WorkspaceAccess | null> {
    const { workspaceId } = req.params as { workspaceId?: string };
    if (!workspaceId || !isValidObjectIdString(workspaceId)) {
      res.status(400).json({ error: 'Invalid workspaceId' });
      return null;
    }

    let workspace: WorkspaceRecord | null;
    try {
      workspace = await deps.getWorkspace(workspaceId);
    } catch (error) {
      logger.error('[workspaces] Error loading workspace', error);
      res.status(500).json({ error: 'Error loading workspace' });
      return null;
    }

    if (!workspace || !matchesTenant(workspace.tenantId, actor.tenantId)) {
      res.status(404).json({ error: NOT_A_MEMBER });
      return null;
    }

    const access = await resolveOrgAccess(toIdString(workspace.organizationId), res, actor);
    if (!access) {
      return null;
    }
    if (!canSeeWorkspace(workspace, access.role, actor.userId)) {
      res.status(404).json({ error: NOT_A_MEMBER });
      return null;
    }

    return { workspace, role: access.role };
  }

  function authorized(res: Response, role: MembershipRole, minimum: MembershipRole): boolean {
    if (meetsRole(role, minimum)) {
      return true;
    }
    res.status(403).json({ error: 'Insufficient workspace permissions' });
    return false;
  }

  async function list(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const organizationId = queryString(req.query.organizationId) ?? '';
    const access = await resolveOrgAccess(organizationId, res, actor);
    if (!access) {
      return res;
    }

    try {
      const workspaces = await deps.listWorkspaces(toIdString(access.organization._id));
      return res.status(200).json({
        workspaces: workspaces
          .filter((workspace) => canSeeWorkspace(workspace, access.role, actor.userId))
          .map(serializeWorkspace),
      });
    } catch (error) {
      logger.error('[workspaces] Error listing workspaces', error);
      return res.status(500).json({ error: 'Error listing workspaces' });
    }
  }

  async function create(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const parsed = createWorkspaceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: describeIssue(parsed.error) });
    }
    const body: WorkspaceCreateRequest = parsed.data;

    const access = await resolveOrgAccess(body.organizationId, res, actor);
    if (!access) {
      return res;
    }
    /** A viewer may read the organization but not add to it. */
    if (!authorized(res, access.role, 'member')) {
      return res;
    }

    try {
      const workspace = await deps.createWorkspace({
        organizationId: toIdString(access.organization._id),
        name: body.name,
        slug: body.slug,
        description: body.description,
        visibility: body.visibility,
        createdBy: actor.userId,
      });
      return res.status(201).json(serializeWorkspace(workspace));
    } catch (error) {
      logger.error('[workspaces] Error creating workspace', error);
      return res.status(500).json({ error: 'Error creating workspace' });
    }
  }

  async function get(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const access = await resolveWorkspaceAccess(req, res, actor);
    if (!access) {
      return res;
    }
    return res.status(200).json(serializeWorkspace(access.workspace));
  }

  async function update(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const access = await resolveWorkspaceAccess(req, res, actor);
    if (!access) {
      return res;
    }
    if (!authorized(res, access.role, 'admin')) {
      return res;
    }

    const parsed = updateWorkspaceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: describeIssue(parsed.error) });
    }
    const body: WorkspaceUpdateRequest = parsed.data;
    if (Object.keys(body).length === 0) {
      return res.status(400).json({ error: 'At least one field must be provided for update' });
    }

    const patch: UpdateWorkspaceInput = {};
    if (body.name !== undefined) {
      patch.name = body.name;
    }
    if (body.description !== undefined) {
      patch.description = body.description;
    }
    if (body.visibility !== undefined) {
      patch.visibility = body.visibility;
    }

    try {
      const updated = await deps.updateWorkspace(toIdString(access.workspace._id), patch);
      if (!updated) {
        return res.status(404).json({ error: NOT_A_MEMBER });
      }
      return res.status(200).json(serializeWorkspace(updated));
    } catch (error) {
      logger.error('[workspaces] Error updating workspace', error);
      return res.status(500).json({ error: 'Error updating workspace' });
    }
  }

  async function remove(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const access = await resolveWorkspaceAccess(req, res, actor);
    if (!access) {
      return res;
    }
    if (!authorized(res, access.role, 'admin')) {
      return res;
    }

    try {
      const deleted = await deps.deleteWorkspace(toIdString(access.workspace._id));
      if (!deleted) {
        return res.status(404).json({ error: NOT_A_MEMBER });
      }
      return res.status(200).json({ deleted: true });
    } catch (error) {
      logger.error('[workspaces] Error deleting workspace', error);
      return res.status(500).json({ error: 'Error deleting workspace' });
    }
  }

  return { list, create, get, update, delete: remove };
}
