import type {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  WorkspaceVisibility,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { MembershipRecord, OrganizationRecord } from '../organizations/types';
import type { ServerRequest } from '~/types';

/**
 * Storage-shaped workspace row. Kept Mongoose-free so `packages/api` never
 * carries `Types.ObjectId` / `Document` in an exported signature; the injected
 * data-schemas methods return values structurally compatible with this.
 */
export interface WorkspaceRecord {
  _id?: unknown;
  organizationId?: unknown;
  name: string;
  slug: string;
  description?: string;
  visibility?: WorkspaceVisibility;
  createdBy?: unknown;
  tenantId?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

/** Wire shape returned by the workspace API; ids are strings and dates are ISO-8601. */
export interface WorkspaceDTO {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description?: string;
  visibility: WorkspaceVisibility;
  createdBy: string;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** `POST /api/workspaces` body. `createdBy` is never accepted from the body. */
export interface WorkspaceCreateRequest {
  organizationId: string;
  name: string;
  /** Derived from `name` when omitted. */
  slug?: string;
  description?: string;
  visibility?: WorkspaceVisibility;
}

/** `PATCH /api/workspaces/:workspaceId` body. */
export interface WorkspaceUpdateRequest {
  name?: string;
  description?: string;
  visibility?: WorkspaceVisibility;
}

/**
 * The subset of `packages/data-schemas` workspace methods the handlers depend
 * on, plus the organization and membership reads needed to place a workspace in
 * its tenant and to answer "what may this user do here".
 */
export interface WorkspaceDataSource {
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord>;
  getWorkspace(workspaceId: string): Promise<WorkspaceRecord | null>;
  listWorkspaces(organizationId: string): Promise<WorkspaceRecord[]>;
  updateWorkspace(
    workspaceId: string,
    patch: UpdateWorkspaceInput,
  ): Promise<WorkspaceRecord | null>;
  deleteWorkspace(workspaceId: string): Promise<boolean>;
  getOrganization(organizationId: string): Promise<OrganizationRecord | null>;
  getMembership(organizationId: string, userId: string): Promise<MembershipRecord | null>;
}

/**
 * The gate every workspace write must pass: confirms the user belongs to the
 * workspace's organization — and, for a `private` workspace, may see it —
 * before anything persists into it. Deny is a throw, so a guard that cannot
 * answer refuses the write rather than admitting it.
 */
export type WorkspaceAccessGuard = (workspaceId: string, userId: string) => Promise<void>;

export interface WorkspaceHandlers {
  list: (req: ServerRequest, res: Response) => Promise<Response>;
  create: (req: ServerRequest, res: Response) => Promise<Response>;
  get: (req: ServerRequest, res: Response) => Promise<Response>;
  update: (req: ServerRequest, res: Response) => Promise<Response>;
  delete: (req: ServerRequest, res: Response) => Promise<Response>;
}
