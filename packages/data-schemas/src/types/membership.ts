import type { Document, Types } from 'mongoose';

/** A user's authority inside an organization (or a workspace of it). */
export type MembershipRole = 'owner' | 'admin' | 'member' | 'viewer';

export type MembershipStatus = 'active' | 'invited' | 'suspended';

/**
 * Links a user to an organization with a role (blueprint §45 `memberships`).
 * Membership is the single source of truth for "which orgs can this user see".
 */
export interface IMembership {
  _id?: Types.ObjectId;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  role: MembershipRole;
  status: MembershipStatus;
  /** Who issued the invite, when the membership did not self-create. */
  invitedBy?: Types.ObjectId;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IMembershipDocument extends Omit<IMembership, '_id'>, Document {}

export interface AddMembershipInput {
  organizationId: string;
  userId: string;
  role?: MembershipRole;
  status?: MembershipStatus;
  invitedBy?: string;
}

export interface UpdateMembershipInput {
  role?: MembershipRole;
  status?: MembershipStatus;
}
