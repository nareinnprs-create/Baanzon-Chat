import { isValidObjectIdString, logger } from '@librechat/data-schemas';
import type { ChatProjectSortBy, ChatProjectSortDirection } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type {
  ChatProjectDTO,
  ChatProjectRecord,
  ProjectCreateInput,
  ProjectDataSource,
  ProjectHandlers,
  ProjectRequest,
  ProjectUpdateInput,
} from './types';
import { matchesTenant } from '../organizations/access';
import { normalizeLimit, queryString } from '~/utils';

const PROJECT_NOT_FOUND = 'Project not found';
const CONVERSATION_NOT_FOUND = 'Conversation not found';
const WORKSPACE_ID_INVALID = 'workspaceId must be a string';
const WORKSPACE_ACCESS_DENIED = 'Insufficient workspace permissions';

const PROJECT_SORT_FIELDS = new Set<ChatProjectSortBy>(['name', 'createdAt', 'lastConversationAt']);

/** The workspace a request is scoped to, or an invalid one that must be refused. */
interface WorkspaceScope {
  valid: boolean;
  workspaceId?: string;
}

const getUserId = (req: ProjectRequest): string => req.user?.id ?? req.user?._id?.toString() ?? '';

const normalizeString = (value: string | null | undefined): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeSortBy = (value: Request['query'][string]): ChatProjectSortBy | undefined => {
  const sortBy = queryString(value);
  return PROJECT_SORT_FIELDS.has(sortBy as ChatProjectSortBy)
    ? (sortBy as ChatProjectSortBy)
    : undefined;
};

const normalizeSortDirection = (
  value: Request['query'][string],
): ChatProjectSortDirection | undefined => {
  const sortDirection = queryString(value);
  return sortDirection === 'asc' || sortDirection === 'desc' ? sortDirection : undefined;
};

/** A workspace id reaches the wire only as a trimmed, non-empty string. */
const normalizeWorkspaceId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const workspaceId = value.trim();
  return workspaceId === '' ? undefined : workspaceId;
};

/**
 * Resolves the workspace a request is scoped to. An absent (or blank) value
 * means "no workspace scope", which is what every caller sent before projects
 * were scoped — those reads keep their current behavior. A present value that
 * is not a string (an array from a repeated query key, a number or object from
 * a JSON body) is refused instead of being silently treated as unscoped, which
 * would answer with every project the user owns.
 */
const resolveWorkspaceScope = (value: unknown): WorkspaceScope => {
  if (value === undefined || value === null) {
    return { valid: true };
  }
  if (typeof value !== 'string') {
    return { valid: false };
  }
  return { valid: true, workspaceId: normalizeWorkspaceId(value) };
};

/**
 * Forwards the stored row unchanged — `_id` and all, so the client's project
 * cache keeps working — adding the workspace only when the project has one, so
 * an unscoped project serializes exactly as it did before the field existed.
 */
export function serializeChatProject(record: ChatProjectRecord): ChatProjectDTO {
  const workspaceId = normalizeWorkspaceId(record.workspaceId);
  return workspaceId == null ? { ...record } : { ...record, workspaceId };
}

const createProjectInput = (req: ProjectRequest): ProjectCreateInput | null => {
  const name = normalizeString(req.body?.name);
  if (!name) {
    return null;
  }

  return {
    name,
    description: typeof req.body?.description === 'string' ? req.body.description : '',
  };
};

export function createProjectHandlers(deps: ProjectDataSource): ProjectHandlers {
  /**
   * Storage filters a workspace-scoped list, but a row that still arrives
   * carrying another workspace is dropped rather than serialized. A project
   * with no workspace is not another workspace's project — it predates scoping —
   * so it stays visible, which is the same populated-equal rule
   * `matchesTenant` applies for tenants.
   */
  function inWorkspace(project: ChatProjectRecord, workspaceId?: string): boolean {
    return matchesTenant(project.workspaceId, workspaceId);
  }

  /**
   * Exercises the workspace authority check before any persist names a
   * workspace. A refusal — no guard wired, or the wired guard throwing —
   * answers 403 without confirming that the workspace exists, and nothing
   * has been written at that point.
   */
  async function requireWorkspaceAccess(
    req: ProjectRequest,
    res: Response,
    workspaceId: string,
  ): Promise<boolean> {
    const assertWorkspaceAccess = deps.assertWorkspaceAccess;
    if (assertWorkspaceAccess == null) {
      logger.error('[projects] No workspace access check is wired; refusing the write');
      res.status(403).json({ error: WORKSPACE_ACCESS_DENIED });
      return false;
    }
    try {
      await assertWorkspaceAccess(workspaceId, getUserId(req));
      return true;
    } catch (error) {
      logger.error('[projects] Error checking workspace access', error);
      res.status(403).json({ error: WORKSPACE_ACCESS_DENIED });
      return false;
    }
  }

  async function listProjects(req: ProjectRequest, res: Response): Promise<Response> {
    const scope = resolveWorkspaceScope(req.query.workspaceId);
    if (!scope.valid) {
      return res.status(400).json({ error: WORKSPACE_ID_INVALID });
    }

    try {
      const result = await deps.listChatProjects(getUserId(req), {
        cursor: queryString(req.query.cursor),
        limit: normalizeLimit(req.query.limit),
        sortBy: normalizeSortBy(req.query.sortBy),
        sortDirection: normalizeSortDirection(req.query.sortDirection),
        search: queryString(req.query.search),
        workspaceId: scope.workspaceId,
      });
      /** Unscoped reads are untouched; a scoped one keeps only this workspace's rows. */
      const projects = scope.workspaceId
        ? result.projects.filter((project) => inWorkspace(project, scope.workspaceId))
        : result.projects;
      return res
        .status(200)
        .json({ ...result, projects: projects.map(serializeChatProject) });
    } catch (error) {
      logger.error('[projects] Error listing projects', error);
      return res.status(500).json({ error: 'Error listing projects' });
    }
  }

  async function createProject(req: ProjectRequest, res: Response): Promise<Response> {
    const input = createProjectInput(req);
    if (!input) {
      return res.status(400).json({ error: 'name is required' });
    }

    const scope = resolveWorkspaceScope(req.body?.workspaceId);
    if (!scope.valid) {
      return res.status(400).json({ error: WORKSPACE_ID_INVALID });
    }

    if (scope.workspaceId) {
      const allowed = await requireWorkspaceAccess(req, res, scope.workspaceId);
      if (!allowed) {
        return res;
      }
    }

    try {
      const project = await deps.createChatProject(getUserId(req), {
        ...input,
        workspaceId: scope.workspaceId,
      });
      return res.status(201).json(serializeChatProject(project));
    } catch (error) {
      logger.error('[projects] Error creating project', error);
      return res.status(500).json({ error: 'Error creating project' });
    }
  }

  async function assignConversationToProject(
    req: ProjectRequest,
    res: Response,
  ): Promise<Response> {
    const { conversationId } = req.params;
    const projectId = req.body?.projectId ?? null;

    if (projectId !== null && typeof projectId !== 'string') {
      return res.status(400).json({ error: 'projectId must be a string or null' });
    }

    try {
      const result = await deps.assignConversationToProject(
        getUserId(req),
        conversationId,
        projectId,
      );
      if (!result) {
        return res.status(404).json({ error: CONVERSATION_NOT_FOUND });
      }
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof Error && error.message === PROJECT_NOT_FOUND) {
        return res.status(404).json({ error: PROJECT_NOT_FOUND });
      }
      logger.error('[projects] Error assigning conversation to project', error);
      return res.status(500).json({ error: 'Error assigning conversation to project' });
    }
  }

  async function getProject(req: ProjectRequest, res: Response): Promise<Response> {
    const { projectId } = req.params;
    if (!isValidObjectIdString(projectId)) {
      return res.status(404).json({ error: PROJECT_NOT_FOUND });
    }

    const scope = resolveWorkspaceScope(req.query.workspaceId);
    if (!scope.valid) {
      return res.status(400).json({ error: WORKSPACE_ID_INVALID });
    }

    try {
      const project = await deps.getChatProject(getUserId(req), projectId);
      /** A project in another workspace reads as missing, never as forbidden. */
      if (!project || !inWorkspace(project, scope.workspaceId)) {
        return res.status(404).json({ error: PROJECT_NOT_FOUND });
      }
      return res.status(200).json(serializeChatProject(project));
    } catch (error) {
      logger.error('[projects] Error getting project', error);
      return res.status(500).json({ error: 'Error getting project' });
    }
  }

  async function updateProject(req: ProjectRequest, res: Response): Promise<Response> {
    const { projectId } = req.params;
    if (!isValidObjectIdString(projectId)) {
      return res.status(404).json({ error: PROJECT_NOT_FOUND });
    }

    const input: ProjectUpdateInput = {};
    if (req.body?.name !== undefined) {
      const name = normalizeString(req.body.name);
      if (!name) {
        return res.status(400).json({ error: 'name is required' });
      }
      input.name = name;
    }
    if (req.body?.description !== undefined) {
      input.description = typeof req.body.description === 'string' ? req.body.description : '';
    }

    const scope = resolveWorkspaceScope(req.body?.workspaceId);
    if (!scope.valid) {
      return res.status(400).json({ error: WORKSPACE_ID_INVALID });
    }
    /**
     * `null` detaches the project from its workspace — storage `$unset`s the
     * field — while a blank value leaves the project where it is. A named
     * workspace passes the authority check before the patch is written.
     */
    if (req.body?.workspaceId !== undefined) {
      if (scope.workspaceId) {
        const allowed = await requireWorkspaceAccess(req, res, scope.workspaceId);
        if (!allowed) {
          return res;
        }
        input.workspaceId = scope.workspaceId;
      } else if (req.body.workspaceId === null) {
        input.workspaceId = null;
      }
    }

    try {
      const project = await deps.updateChatProject(getUserId(req), projectId, input);
      if (!project) {
        return res.status(404).json({ error: PROJECT_NOT_FOUND });
      }
      return res.status(200).json(serializeChatProject(project));
    } catch (error) {
      logger.error('[projects] Error updating project', error);
      return res.status(500).json({ error: 'Error updating project' });
    }
  }

  async function deleteProject(req: ProjectRequest, res: Response): Promise<Response> {
    const { projectId } = req.params;
    if (!isValidObjectIdString(projectId)) {
      return res.status(404).json({ error: PROJECT_NOT_FOUND });
    }

    try {
      const result = await deps.deleteChatProject(getUserId(req), projectId);
      if (!result.deletedCount) {
        return res.status(404).json({ error: PROJECT_NOT_FOUND });
      }
      return res.status(200).json(result);
    } catch (error) {
      logger.error('[projects] Error deleting project', error);
      return res.status(500).json({ error: 'Error deleting project' });
    }
  }

  return {
    listProjects,
    createProject,
    assignConversationToProject,
    getProject,
    updateProject,
    deleteProject,
  };
}