import type { Document, Types } from 'mongoose';

/** Lifecycle state of an organization. */
export type OrganizationStatus = 'active' | 'suspended';

/**
 * A tenant-scoped organization (blueprint §45 `organizations`, §57 org root of
 * the org -> workspace -> project hierarchy).
 *
 * The shape is plain and engine-free: methods hand back `IOrganization`, never
 * a Mongoose document, so the storage engine stays out of the caller's API.
 */
export interface IOrganization {
  _id?: Types.ObjectId;
  name: string;
  /** URL-safe unique handle within the tenant. */
  slug: string;
  /** The user who created the organization; always the first owner. */
  owner: Types.ObjectId;
  status: OrganizationStatus;
  /** Personal orgs back a single user and are created implicitly. */
  isPersonal: boolean;
  /** Free-form organization settings; opaque to this package. */
  settings?: Record<string, unknown>;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IOrganizationDocument extends Omit<IOrganization, '_id'>, Document {}

export interface CreateOrganizationInput {
  name: string;
  owner: string;
  /** Derived from `name` when omitted. */
  slug?: string;
  isPersonal?: boolean;
  settings?: Record<string, unknown>;
}

export interface UpdateOrganizationInput {
  name?: string;
  status?: OrganizationStatus;
  settings?: Record<string, unknown>;
}
