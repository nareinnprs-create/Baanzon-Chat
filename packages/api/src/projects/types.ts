import type { ChatProjectSortBy, ChatProjectSortDirection } from '@librechat/data-schemas';
import type { Request, Response } from 'express';

/**
 * Storage-shaped project row. Kept Mongoose-free and declared here rather than
 * imported from `packages/data-schemas`, so this module never carries
 * `Types.ObjectId` / `Document` in an exported signature and its contract does
 * not track the storage build: ids are `unknown`, dates are `Date | string`,
 * and the injected data-schemas methods return values structurally compatible
 * with this.
 */
export interface ChatProjectRecord {
  _id?: unknown;
  name: string;
  description?: string;
  user?: string;
  conversationCount?: number;
  lastConversationAt?: Date | string | null;
  lastConversationId?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  /** Workspace the project belongs to; absent on projects created before scoping. */
  workspaceId?: string;
  tenantId?: string;
}

/**
 * Wire shape returned by the project API. Field-for-field the storage row —
 * `_id` included, since the client keys its project cache on it — with the
 * workspace normalized to a trimmed string or nothing, so adding `workspaceId`
 * to the document is the only difference a caller sees.
 */
export type ChatProjectDTO = ChatProjectRecord;

/** A page of projects plus the cursor for the next one. */
export interface ChatProjectListResult {
  projects: ChatProjectRecord[];
  nextCursor?: string | null;
}

/**
 * `GET /api/projects` options. `workspaceId` scopes the read to one workspace:
 * it is pushed down so storage filters before paginating, and re-checked on
 * every row the handler serializes.
 */
export interface ListChatProjectsQuery {
  cursor?: string | null;
  limit?: number;
  sortBy?: ChatProjectSortBy;
  sortDirection?: ChatProjectSortDirection;
  search?: string;
  workspaceId?: string;
}

/** `POST /api/projects` body. `workspaceId` is optional: omitted means unscoped. */
export interface ProjectCreateInput {
  name: string;
  description?: string;
  workspaceId?: string;
}

/** `PATCH /api/projects/:projectId` body; a missing key leaves the field alone. */
export interface ProjectUpdateInput {
  name?: string;
  description?: string;
  workspaceId?: string;
}

export interface ProjectDeleteResult {
  deletedCount: number;
  modifiedCount?: number;
}

/**
 * The conversation assignment result, forwarded verbatim. The conversation
 * document is a Mongoose document, so it stays `unknown` here rather than
 * dragging the storage types across the module boundary.
 */
export type ProjectAssignment = Record<string, unknown>;

/**
 * The subset of `packages/data-schemas` chat-project methods the handlers
 * depend on. Every call is scoped to the authenticated user inside storage;
 * `workspaceId` narrows that further.
 */
export interface ProjectDataSource {
  listChatProjects(user: string, query?: ListChatProjectsQuery): Promise<ChatProjectListResult>;
  createChatProject(user: string, input: ProjectCreateInput): Promise<ChatProjectRecord>;
  getChatProject(user: string, projectId: string): Promise<ChatProjectRecord | null>;
  updateChatProject(
    user: string,
    projectId: string,
    input: ProjectUpdateInput,
  ): Promise<ChatProjectRecord | null>;
  deleteChatProject(user: string, projectId: string): Promise<ProjectDeleteResult>;
  assignConversationToProject(
    user: string,
    conversationId: string,
    projectId: string | null,
  ): Promise<ProjectAssignment | null>;
}

export interface ProjectRequestUser {
  id: string;
  _id?: {
    toString(): string;
  };
}

export interface ProjectRequest extends Request {
  user?: ProjectRequestUser;
}

export interface ProjectHandlers {
  listProjects: (req: ProjectRequest, res: Response) => Promise<Response>;
  createProject: (req: ProjectRequest, res: Response) => Promise<Response>;
  assignConversationToProject: (req: ProjectRequest, res: Response) => Promise<Response>;
  getProject: (req: ProjectRequest, res: Response) => Promise<Response>;
  updateProject: (req: ProjectRequest, res: Response) => Promise<Response>;
  deleteProject: (req: ProjectRequest, res: Response) => Promise<Response>;
}