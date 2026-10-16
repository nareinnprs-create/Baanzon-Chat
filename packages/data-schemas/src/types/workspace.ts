import type { Document, Types } from 'mongoose';

/** Who inside an organization can see a workspace. */
export type WorkspaceVisibility = 'private' | 'org';

/**
 * A named container inside an organization (blueprint §45 `workspaces`, §57
 * middle rung of the org -> workspace -> project hierarchy).
 */
export interface IWorkspace {
  _id?: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  /** URL-safe unique handle within the organization. */
  slug: string;
  description?: string;
  visibility: WorkspaceVisibility;
  createdBy: Types.ObjectId;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IWorkspaceDocument extends Omit<IWorkspace, '_id'>, Document {}

export interface CreateWorkspaceInput {
  organizationId: string;
  name: string;
  createdBy: string;
  /** Derived from `name` when omitted. */
  slug?: string;
  description?: string;
  visibility?: WorkspaceVisibility;
}

export interface UpdateWorkspaceInput {
  name?: string;
  description?: string;
  visibility?: WorkspaceVisibility;
}
