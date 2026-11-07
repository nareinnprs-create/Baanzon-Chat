import type {
  AddMembershipInput,
  CreateOrganizationInput,
  MembershipRole,
  MembershipStatus,
  OrganizationStatus,
  UpdateMembershipInput,
  UpdateOrganizationInput,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types';

/**
 * Storage-shaped organization row. Kept Mongoose-free so `packages/api` never
 * carries `Types.ObjectId` / `Document` in an exported signature; the injected
 * data-schemas methods return values structurally compatible with this.
 */
export interface OrganizationRecord {
  _id?: unknown;
  name: string;
  slug: string;
  /** ObjectId in storage; never surfaced to a caller as anything but a string. */
  owner?: unknown;
  status?: OrganizationStatus;
  isPersonal?: boolean;
  settings?: Record<string, unknown>;
  tenantId?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

/** Storage-shaped membership row; see {@link OrganizationRecord} for why ids are `unknown`. */
export interface MembershipRecord {
  _id?: unknown;
  organizationId?: unknown;
  userId?: unknown;
  role?: MembershipRole;
  status?: MembershipStatus;
  invitedBy?: unknown;
  tenantId?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

/** Wire shape returned by the organization API; ids are strings and dates are ISO-8601. */
export interface OrganizationDTO {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  status: OrganizationStatus;
  isPersonal: boolean;
  settings?: Record<string, unknown>;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MembershipDTO {
  id: string;
  organizationId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
  invitedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * `POST /api/organizations` body. `owner` is never accepted from the body: the
 * authenticated user always becomes the first owner.
 */
export interface OrganizationCreateRequest {
  name: string;
  /** Derived from `name` when omitted. */
  slug?: string;
  settings?: Record<string, unknown>;
}

/** `PATCH /api/organizations/:organizationId` body. `status` is owner-only. */
export interface OrganizationUpdateRequest {
  name?: string;
  settings?: Record<string, unknown>;
  status?: OrganizationStatus;
}

/** Roles a membership invitation may grant. `owner` is deliberately unreachable. */
export type GrantableMembershipRole = Exclude<MembershipRole, 'owner'>;

/** `POST /api/organizations/:organizationId/members` body. */
export interface MembershipAddRequest {
  userId: string;
  role?: GrantableMembershipRole;
  status?: MembershipStatus;
}

/** `PATCH /api/organizations/:organizationId/members/:userId` body. */
export interface MembershipUpdateRequest {
  role?: GrantableMembershipRole;
  status?: MembershipStatus;
}

/**
 * The subset of `packages/data-schemas` organization + membership methods the
 * handlers depend on. Membership is the single source of truth for
 * "which organizations can this user see", so it travels with the org methods.
 */
export interface OrganizationDataSource {
  createOrganization(input: CreateOrganizationInput): Promise<OrganizationRecord>;
  getOrganization(organizationId: string): Promise<OrganizationRecord | null>;
  listOrganizationsForUser(userId: string): Promise<OrganizationRecord[]>;
  updateOrganization(
    organizationId: string,
    patch: UpdateOrganizationInput,
  ): Promise<OrganizationRecord | null>;
  deleteOrganization(organizationId: string): Promise<boolean>;
  getMembership(organizationId: string, userId: string): Promise<MembershipRecord | null>;
  listOrganizationMemberships(organizationId: string): Promise<MembershipRecord[]>;
  addMembership(input: AddMembershipInput): Promise<MembershipRecord>;
  updateMembership(
    organizationId: string,
    userId: string,
    patch: UpdateMembershipInput,
  ): Promise<MembershipRecord | null>;
  removeMembership(organizationId: string, userId: string): Promise<boolean>;
}

export interface OrganizationHandlers {
  list: (req: ServerRequest, res: Response) => Promise<Response>;
  create: (req: ServerRequest, res: Response) => Promise<Response>;
  get: (req: ServerRequest, res: Response) => Promise<Response>;
  update: (req: ServerRequest, res: Response) => Promise<Response>;
  delete: (req: ServerRequest, res: Response) => Promise<Response>;
  listMembers: (req: ServerRequest, res: Response) => Promise<Response>;
  addMember: (req: ServerRequest, res: Response) => Promise<Response>;
  updateMember: (req: ServerRequest, res: Response) => Promise<Response>;
  removeMember: (req: ServerRequest, res: Response) => Promise<Response>;
}
