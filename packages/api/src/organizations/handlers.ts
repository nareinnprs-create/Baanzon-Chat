import { z } from 'zod';
import { isValidObjectIdString, logger } from '@librechat/data-schemas';
import type { UpdateMembershipInput, UpdateOrganizationInput } from '@librechat/data-schemas';
import type { Response } from 'express';
import type {
  MembershipAddRequest,
  MembershipDTO,
  MembershipRecord,
  MembershipUpdateRequest,
  OrganizationDataSource,
  OrganizationDTO,
  OrganizationHandlers,
  OrganizationRecord,
} from './types';
import type { ServerRequest } from '~/types';
import { matchesTenant, meetsRole, resolveOrganizationRole, toIdString, toIso } from './access';
import { resolveRequestTenantId } from '~/middleware/tenant';

const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(200).optional(),
  settings: z.record(z.unknown()).optional(),
});

const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  settings: z.record(z.unknown()).optional(),
});

/** `owner` is excluded: ownership comes from the organization document, never an invite. */
const addMemberSchema = z.object({
  userId: z.string().trim().min(1),
  role: z.enum(['admin', 'member', 'viewer']).optional(),
  status: z.enum(['active', 'invited', 'suspended']).optional(),
});

const updateMemberSchema = z.object({
  role: z.enum(['admin', 'member', 'viewer']).optional(),
  status: z.enum(['active', 'invited', 'suspended']).optional(),
});

interface Actor {
  userId: string;
  tenantId?: string;
}

/** An organization the requester reached, with the authority they hold in it. */
interface OrgAccess {
  organization: OrganizationRecord;
  role: NonNullable<ReturnType<typeof resolveOrganizationRole>>;
}

const NOT_A_MEMBER = 'Organization not found';

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return 'Invalid organization payload';
  }
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function serializeOrganization(record: OrganizationRecord): OrganizationDTO {
  return {
    id: toIdString(record._id),
    name: record.name,
    slug: record.slug,
    ownerId: toIdString(record.owner),
    status: record.status ?? 'active',
    isPersonal: record.isPersonal ?? false,
    settings: record.settings,
    tenantId: record.tenantId,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

export function serializeMembership(record: MembershipRecord): MembershipDTO {
  return {
    id: toIdString(record._id),
    organizationId: toIdString(record.organizationId),
    userId: toIdString(record.userId),
    role: record.role ?? 'member',
    status: record.status ?? 'active',
    invitedBy: record.invitedBy == null ? undefined : toIdString(record.invitedBy),
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

export function createOrganizationHandlers(deps: OrganizationDataSource): OrganizationHandlers {
  function resolveActor(req: ServerRequest, res: Response): Actor | null {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return null;
    }
    return { userId, tenantId: resolveRequestTenantId(req) };
  }

  /**
   * Loads the organization in `:organizationId` and the requester's authority in
   * it. A missing organization, a tenant mismatch and a non-member are the same
   * 404: an outsider must not learn that the organization exists.
   */
  async function resolveOrgAccess(
    req: ServerRequest,
    res: Response,
    actor: Actor,
  ): Promise<OrgAccess | null> {
    const { organizationId } = req.params as { organizationId?: string };
    if (!organizationId || !isValidObjectIdString(organizationId)) {
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
      logger.error('[organizations] Error loading organization', error);
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

  /** Writes 403 and returns false when the requester's role is below `minimum`. */
  function authorized(
    res: Response,
    access: OrgAccess,
    minimum: NonNullable<OrgAccess['role']>,
  ): boolean {
    if (meetsRole(access.role, minimum)) {
      return true;
    }
    res.status(403).json({ error: 'Insufficient organization permissions' });
    return false;
  }

  async function list(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    try {
      const organizations = await deps.listOrganizationsForUser(actor.userId);
      return res.status(200).json({ organizations: organizations.map(serializeOrganization) });
    } catch (error) {
      logger.error('[organizations] Error listing organizations', error);
      return res.status(500).json({ error: 'Error listing organizations' });
    }
  }

  async function create(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const parsed = createOrganizationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: describeIssue(parsed.error) });
    }

    try {
      /** The creator is the owner, so they get the owner membership in the same call. */
      const organization = await deps.createOrganization({
        name: parsed.data.name,
        slug: parsed.data.slug,
        settings: parsed.data.settings,
        owner: actor.userId,
      });
      const organizationId = toIdString(organization._id);
      if (organizationId) {
        await deps.addMembership({ organizationId, userId: actor.userId, role: 'owner' });
      }
      return res.status(201).json(serializeOrganization(organization));
    } catch (error) {
      logger.error('[organizations] Error creating organization', error);
      return res.status(500).json({ error: 'Error creating organization' });
    }
  }

  async function get(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const access = await resolveOrgAccess(req, res, actor);
    if (!access) {
      return res;
    }
    return res.status(200).json(serializeOrganization(access.organization));
  }

  async function update(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const access = await resolveOrgAccess(req, res, actor);
    if (!access) {
      return res;
    }
    if (!authorized(res, access, 'admin')) {
      return res;
    }

    const parsed = updateOrganizationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: describeIssue(parsed.error) });
    }

    const patch: UpdateOrganizationInput = {};
    if (parsed.data.name !== undefined) {
      patch.name = parsed.data.name;
    }
    if (parsed.data.settings !== undefined) {
      patch.settings = parsed.data.settings;
    }
    if (parsed.data.status !== undefined) {
      /** Suspending an organization locks out every member, so it stays owner-only. */
      if (!meetsRole(access.role, 'owner')) {
        return res.status(403).json({ error: 'Only the organization owner can change status' });
      }
      patch.status = parsed.data.status;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'At least one field must be provided for update' });
    }

    try {
      const organizationId = toIdString(access.organization._id);
      const updated = await deps.updateOrganization(organizationId, patch);
      if (!updated) {
        return res.status(404).json({ error: NOT_A_MEMBER });
      }
      return res.status(200).json(serializeOrganization(updated));
    } catch (error) {
      logger.error('[organizations] Error updating organization', error);
      return res.status(500).json({ error: 'Error updating organization' });
    }
  }

  async function remove(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const access = await resolveOrgAccess(req, res, actor);
    if (!access) {
      return res;
    }
    if (!authorized(res, access, 'owner')) {
      return res;
    }

    try {
      const deleted = await deps.deleteOrganization(toIdString(access.organization._id));
      if (!deleted) {
        return res.status(404).json({ error: NOT_A_MEMBER });
      }
      return res.status(200).json({ deleted: true });
    } catch (error) {
      logger.error('[organizations] Error deleting organization', error);
      return res.status(500).json({ error: 'Error deleting organization' });
    }
  }

  async function listMembers(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const access = await resolveOrgAccess(req, res, actor);
    if (!access) {
      return res;
    }
    if (!authorized(res, access, 'admin')) {
      return res;
    }

    try {
      const memberships = await deps.listOrganizationMemberships(
        toIdString(access.organization._id),
      );
      return res.status(200).json({ members: memberships.map(serializeMembership) });
    } catch (error) {
      logger.error('[organizations] Error listing organization members', error);
      return res.status(500).json({ error: 'Error listing organization members' });
    }
  }

  async function addMember(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const access = await resolveOrgAccess(req, res, actor);
    if (!access) {
      return res;
    }
    if (!authorized(res, access, 'admin')) {
      return res;
    }

    const parsed = addMemberSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: describeIssue(parsed.error) });
    }
    const body: MembershipAddRequest = parsed.data;
    if (!isValidObjectIdString(body.userId)) {
      return res.status(400).json({ error: 'userId must be a valid id' });
    }

    try {
      const organizationId = toIdString(access.organization._id);
      const existing = await deps.getMembership(organizationId, body.userId);
      if (existing && existing.role === 'owner' && !meetsRole(access.role, 'owner')) {
        return res.status(403).json({ error: 'Only the organization owner can change the owner' });
      }

      const membership = await deps.addMembership({
        organizationId,
        userId: body.userId,
        role: body.role ?? 'member',
        status: body.status,
        invitedBy: actor.userId,
      });
      return res.status(201).json(serializeMembership(membership));
    } catch (error) {
      logger.error('[organizations] Error adding organization member', error);
      return res.status(500).json({ error: 'Error adding organization member' });
    }
  }

  async function updateMember(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const access = await resolveOrgAccess(req, res, actor);
    if (!access) {
      return res;
    }
    if (!authorized(res, access, 'admin')) {
      return res;
    }

    const { userId } = req.params as { userId?: string };
    if (!userId || !isValidObjectIdString(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    const parsed = updateMemberSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: describeIssue(parsed.error) });
    }
    const body: MembershipUpdateRequest = parsed.data;
    if (Object.keys(body).length === 0) {
      return res.status(400).json({ error: 'At least one field must be provided for update' });
    }

    try {
      const organizationId = toIdString(access.organization._id);
      const existing = await deps.getMembership(organizationId, userId);
      if (!existing) {
        return res.status(404).json({ error: 'Member not found' });
      }
      /** Admins cannot touch their peers; the owner is the only authority over admins. */
      const protectedRole = existing.role === 'owner' || existing.role === 'admin';
      if (protectedRole && !meetsRole(access.role, 'owner')) {
        return res
          .status(403)
          .json({ error: 'Only the organization owner can change this member' });
      }

      const patch: UpdateMembershipInput = {};
      if (body.role !== undefined) {
        patch.role = body.role;
      }
      if (body.status !== undefined) {
        patch.status = body.status;
      }
      const updated = await deps.updateMembership(organizationId, userId, patch);
      if (!updated) {
        return res.status(404).json({ error: 'Member not found' });
      }
      return res.status(200).json(serializeMembership(updated));
    } catch (error) {
      logger.error('[organizations] Error updating organization member', error);
      return res.status(500).json({ error: 'Error updating organization member' });
    }
  }

  async function removeMember(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const access = await resolveOrgAccess(req, res, actor);
    if (!access) {
      return res;
    }
    if (!authorized(res, access, 'admin')) {
      return res;
    }

    const { userId } = req.params as { userId?: string };
    if (!userId || !isValidObjectIdString(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    try {
      const organizationId = toIdString(access.organization._id);
      const existing = await deps.getMembership(organizationId, userId);
      if (!existing) {
        return res.status(404).json({ error: 'Member not found' });
      }
      if (existing.role === 'owner' || toIdString(access.organization.owner) === userId) {
        return res.status(400).json({ error: 'The organization owner cannot be removed' });
      }
      if (existing.role === 'admin' && !meetsRole(access.role, 'owner')) {
        return res
          .status(403)
          .json({ error: 'Only the organization owner can remove this member' });
      }

      const removed = await deps.removeMembership(organizationId, userId);
      if (!removed) {
        return res.status(404).json({ error: 'Member not found' });
      }
      return res.status(200).json({ deleted: true });
    } catch (error) {
      logger.error('[organizations] Error removing organization member', error);
      return res.status(500).json({ error: 'Error removing organization member' });
    }
  }

  return {
    list,
    create,
    get,
    update,
    delete: remove,
    listMembers,
    addMember,
    updateMember,
    removeMember,
  };
}
