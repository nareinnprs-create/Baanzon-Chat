import type { MembershipRole } from '@librechat/data-schemas';
import type { MembershipRecord, OrganizationRecord } from './types';

/**
 * Ordered authority inside an organization. `owner` outranks every grantable
 * role, and the document's `owner` field — not a membership row — is what
 * confers it, so an owner cannot be demoted by editing a membership.
 */
export const MEMBERSHIP_ROLE_RANK: Readonly<Record<MembershipRole, number>> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

export function toIdString(value: unknown): string {
  return value == null ? '' : String(value);
}

export function toIso(value?: Date | string): string | undefined {
  if (value == null) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * A record without a tenant, or a request without one, is unconstrained: this
 * matches the single-tenant deployments that never populate `tenantId`. Two
 * populated values must be equal.
 */
export function matchesTenant(
  recordTenantId: string | undefined,
  requestTenantId?: string,
): boolean {
  if (recordTenantId != null && requestTenantId != null) {
    return recordTenantId === requestTenantId;
  }
  return true;
}

/**
 * Resolves the requester's authority in an organization. The document owner
 * wins over any membership row; a non-active membership (invited, suspended)
 * grants nothing. `null` means "not a member", which handlers answer with 404
 * so membership is never confirmed to an outsider.
 */
export function resolveOrganizationRole(params: {
  organization: OrganizationRecord;
  membership: MembershipRecord | null;
  userId: string;
}): MembershipRole | null {
  const { organization, membership, userId } = params;
  if (!userId) {
    return null;
  }
  if (toIdString(organization.owner) === userId) {
    return 'owner';
  }
  if (!membership || membership.status !== 'active') {
    return null;
  }
  return membership.role ?? null;
}

export function meetsRole(role: MembershipRole | null, minimum: MembershipRole): boolean {
  if (role == null) {
    return false;
  }
  return MEMBERSHIP_ROLE_RANK[role] >= MEMBERSHIP_ROLE_RANK[minimum];
}
