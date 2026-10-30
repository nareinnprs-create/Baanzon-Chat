import {
  MAX_CHAT_PROJECT_NAME_LENGTH,
  MAX_CHAT_PROJECT_DESCRIPTION_LENGTH,
} from 'librechat-data-provider';
import type { FilterQuery, Model, SortOrder, Types, UpdateQuery } from 'mongoose';
import type { IChatProject, IChatProjectDocument, IConversation } from '~/types';
import { buildRetentionVisibilityFilter } from '~/utils/retention';
import { isValidObjectIdString } from '~/utils/objectId';
import { escapeRegExp } from '~/utils/string';
import logger from '~/config/winston';

export type ChatProjectSortBy = 'name' | 'createdAt' | 'lastConversationAt';
export type ChatProjectSortDirection = 'asc' | 'desc';

export type CreateChatProjectInput = {
  name: string;
  description?: string | null;
  /**
   * Owning workspace as its ObjectId hex string. Optional — a project may live
   * outside any workspace, and every project created before this field existed
   * has none.
   */
  workspaceId?: string | null;
};

export type UpdateChatProjectInput = Partial<CreateChatProjectInput>;

export type ListChatProjectsOptions = {
  cursor?: string | null;
  limit?: number;
  sortBy?: ChatProjectSortBy;
  sortDirection?: ChatProjectSortDirection;
  search?: string;
  /** Narrows the list to one workspace, composed with the user scope. */
  workspaceId?: string | null;
};

export type ListChatProjectsResult = {
  projects: IChatProject[];
  nextCursor: string | null;
};

/** Small projection for cross-entity palette search: enough to list and navigate. */
export type ChatProjectTitleHit = {
  id: string;
  name: string;
  lastConversationAt: Date | null;
};

export type DeleteChatProjectResult = {
  deletedCount: number;
  modifiedCount: number;
};

export type AssignConversationToProjectResult = {
  conversation: IConversation;
  previousProjectId: string | null;
  projectId: string | null;
};

export interface ChatProjectMethods {
  createChatProject(user: string, input: CreateChatProjectInput): Promise<IChatProject>;
  getChatProject(user: string, projectId: string): Promise<IChatProject | null>;
  listChatProjects(
    user: string,
    options?: ListChatProjectsOptions,
  ): Promise<ListChatProjectsResult>;
  /** Lists every member's projects in one workspace; tenant scope still applies. */
  listWorkspaceChatProjects(
    workspaceId: string,
    options?: ListChatProjectsOptions,
  ): Promise<ListChatProjectsResult>;
  /** Cross-entity palette search: bounded case-insensitive name/description hits for one user. */
  searchChatProjectsByTitle(
    user: string,
    query: string,
    limit?: number,
  ): Promise<ChatProjectTitleHit[]>;
  updateChatProject(
    user: string,
    projectId: string,
    input: UpdateChatProjectInput,
  ): Promise<IChatProject | null>;
  deleteChatProject(user: string, projectId: string): Promise<DeleteChatProjectResult>;
  assignConversationToProject(
    user: string,
    conversationId: string,
    projectId: string | null,
  ): Promise<AssignConversationToProjectResult | null>;
  refreshChatProjectStats(user: string, projectId: string): Promise<IChatProject | null>;
}

type ProjectCursor = {
  primary: string | null;
  id: string;
};

type ProjectLean = IChatProject & { _id: Types.ObjectId };
type ProjectStatsSnapshot = Pick<
  IChatProject,
  'conversationCount' | 'lastConversationAt' | 'lastConversationId'
>;

const VALID_SORT_FIELDS = new Set<ChatProjectSortBy>(['name', 'createdAt', 'lastConversationAt']);
const PROJECT_STATS_REFRESH_MAX_ATTEMPTS = 8;
/** Per-request default and hard cap for `searchChatProjectsByTitle`. */
const DEFAULT_TITLE_SEARCH_LIMIT = 10;
const MAX_TITLE_SEARCH_LIMIT = 20;

function normalizeSortBy(sortBy?: string): ChatProjectSortBy {
  return VALID_SORT_FIELDS.has(sortBy as ChatProjectSortBy)
    ? (sortBy as ChatProjectSortBy)
    : 'lastConversationAt';
}

function normalizeSortDirection(sortDirection?: string): ChatProjectSortDirection {
  return sortDirection === 'asc' ? 'asc' : 'desc';
}

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit) || !limit) {
    return 25;
  }
  return Math.min(Math.max(Math.floor(limit), 1), 100);
}

/**
 * Validates a workspace ObjectId string. Absent/null means "no workspace", which
 * is legal and common (pre-workspace and personal projects).
 */
function normalizeWorkspaceId(workspaceId: string | null | undefined): string | undefined {
  if (workspaceId === undefined || workspaceId === null || workspaceId === '') {
    return undefined;
  }
  if (!isValidObjectIdString(workspaceId)) {
    throw new Error('A valid workspaceId is required');
  }
  return workspaceId;
}

function sanitizeProjectInput(input: CreateChatProjectInput): CreateChatProjectInput {
  const workspaceId = normalizeWorkspaceId(input.workspaceId);
  return {
    name: input.name.trim().slice(0, MAX_CHAT_PROJECT_NAME_LENGTH),
    description: input.description?.trim().slice(0, MAX_CHAT_PROJECT_DESCRIPTION_LENGTH) ?? '',
    ...(workspaceId != null ? { workspaceId } : {}),
  };
}

function parseCursor(cursor?: string | null): ProjectCursor | null {
  if (!cursor) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString()) as ProjectCursor;
    if (!decoded.id || !isValidObjectIdString(decoded.id)) {
      return null;
    }
    return {
      primary: decoded.primary ?? null,
      id: decoded.id,
    };
  } catch {
    logger.warn('[listChatProjects] Invalid cursor format, starting from beginning');
    return null;
  }
}

function encodeCursor(project: ProjectLean, sortBy: ChatProjectSortBy): string {
  let primary: string | null = null;
  if (sortBy === 'name') {
    primary = project.name;
  } else {
    const date = project[sortBy];
    primary = date instanceof Date ? date.toISOString() : null;
  }
  return Buffer.from(JSON.stringify({ primary, id: project._id.toString() })).toString('base64');
}

function cursorPrimaryValue(
  primary: string | null,
  sortBy: ChatProjectSortBy,
): string | Date | null | undefined {
  if (primary == null) {
    return sortBy === 'lastConversationAt' ? null : undefined;
  }

  if (sortBy === 'name') {
    return primary;
  }

  const date = new Date(primary);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function createCursorFilter(
  mongoose: typeof import('mongoose'),
  cursor: ProjectCursor | null,
  sortBy: ChatProjectSortBy,
  sortDirection: ChatProjectSortDirection,
): FilterQuery<IChatProjectDocument> | null {
  if (!cursor) {
    return null;
  }

  const op = sortDirection === 'asc' ? '$gt' : '$lt';
  const id = new mongoose.Types.ObjectId(cursor.id);
  const primary = cursorPrimaryValue(cursor.primary, sortBy);

  if (primary === undefined) {
    logger.warn('[listChatProjects] Invalid cursor primary value, starting from beginning');
    return null;
  }

  const branches: FilterQuery<IChatProjectDocument>[] = [
    { [sortBy]: { [op]: primary } },
    { [sortBy]: primary, _id: { [op]: id } },
  ];

  /**
   * Projects with no conversations have `lastConversationAt: null`, which sorts
   * after all dated projects in descending order. A `$lt: <date>` predicate does
   * not match null, so once the cursor moves past the dated projects we must
   * include the null bucket explicitly, otherwise empty projects never paginate.
   */
  if (sortBy === 'lastConversationAt' && sortDirection === 'desc' && primary instanceof Date) {
    branches.push({ lastConversationAt: null } as FilterQuery<IChatProjectDocument>);
  }

  return { $or: branches } as FilterQuery<IChatProjectDocument>;
}

function visibleProjectConversationFilter(
  user: string,
  projectId: string,
): FilterQuery<IConversation> {
  return {
    $and: [
      { user, chatProjectId: projectId },
      { $or: [{ isArchived: false }, { isArchived: { $exists: false } }] },
      buildRetentionVisibilityFilter<IConversation>(),
    ],
  } as FilterQuery<IConversation>;
}

function projectStatsSnapshotFilter(
  snapshot: ProjectStatsSnapshot,
): FilterQuery<IChatProjectDocument> {
  return {
    conversationCount:
      snapshot.conversationCount === undefined ? { $exists: false } : snapshot.conversationCount,
    lastConversationAt:
      snapshot.lastConversationAt === undefined ? { $exists: false } : snapshot.lastConversationAt,
    lastConversationId:
      snapshot.lastConversationId === undefined ? { $exists: false } : snapshot.lastConversationId,
  };
}

/**
 * The shared list body behind both list methods: `scope` is the authorization
 * filter (`{ user }`, or `{ workspaceId }` for a workspace-wide read) and every
 * other filter composes with it rather than replacing it. Tenant isolation is
 * injected by the schema plugin, so it holds for both shapes.
 */
async function queryProjects(
  mongoose: typeof import('mongoose'),
  scope: FilterQuery<IChatProjectDocument>,
  options: ListChatProjectsOptions,
): Promise<ListChatProjectsResult> {
  const ChatProject = mongoose.models.ChatProject as Model<IChatProjectDocument>;
  const limit = normalizeLimit(options.limit);
  const sortBy = normalizeSortBy(options.sortBy);
  const sortDirection = normalizeSortDirection(options.sortDirection);
  const sortOrder: SortOrder = sortDirection === 'asc' ? 1 : -1;
  const filters: FilterQuery<IChatProjectDocument>[] = [scope];

  if (options.search?.trim()) {
    const searchRegex = { $regex: escapeRegExp(options.search.trim()), $options: 'i' };
    filters.push({ $or: [{ name: searchRegex }, { description: searchRegex }] });
  }

  const cursorFilter = createCursorFilter(
    mongoose,
    parseCursor(options.cursor),
    sortBy,
    sortDirection,
  );
  if (cursorFilter) {
    filters.push(cursorFilter);
  }

  const query =
    filters.length === 1 ? filters[0] : ({ $and: filters } as FilterQuery<IChatProjectDocument>);
  const projects = await ChatProject.find(query)
    .sort({ [sortBy]: sortOrder, _id: sortOrder })
    .limit(limit + 1)
    .lean<ProjectLean[]>();

  let nextCursor: string | null = null;
  if (projects.length > limit) {
    projects.pop();
    const lastProject = projects[projects.length - 1];
    if (lastProject) {
      nextCursor = encodeCursor(lastProject, sortBy);
    }
  }

  return { projects, nextCursor };
}

export async function refreshChatProjectStatsForUser(
  mongoose: typeof import('mongoose'),
  user: string,
  projectId: string,
): Promise<IChatProject | null> {
  if (!isValidObjectIdString(projectId)) {
    return null;
  }

  const ChatProject = mongoose.models.ChatProject as Model<IChatProjectDocument>;
  const Conversation = mongoose.models.Conversation as Model<IConversation>;
  const projectFilter = { _id: new mongoose.Types.ObjectId(projectId), user };
  const conversationFilter = visibleProjectConversationFilter(user, projectId);

  for (let attempt = 0; attempt < PROJECT_STATS_REFRESH_MAX_ATTEMPTS; attempt++) {
    const snapshot = await ChatProject.findOne(projectFilter)
      .select('conversationCount lastConversationAt lastConversationId')
      .lean<ProjectStatsSnapshot>();
    if (!snapshot) {
      return null;
    }

    const [conversationCount, latestConversation] = await Promise.all([
      Conversation.countDocuments(conversationFilter),
      Conversation.findOne(conversationFilter)
        .select('conversationId updatedAt createdAt')
        .sort({ updatedAt: -1, _id: -1 })
        .lean<IConversation>(),
    ]);

    const updatedProject = await ChatProject.findOneAndUpdate(
      { ...projectFilter, ...projectStatsSnapshotFilter(snapshot) },
      {
        $set: {
          conversationCount,
          lastConversationAt:
            latestConversation?.updatedAt ?? latestConversation?.createdAt ?? null,
          lastConversationId: latestConversation?.conversationId ?? null,
        },
      },
      { new: true },
    ).lean<IChatProject>();
    if (updatedProject) {
      return updatedProject;
    }
  }

  logger.warn('[refreshChatProjectStatsForUser] Stats changed during every refresh attempt', {
    user,
    projectId,
  });
  throw new Error('Failed to refresh chat project stats after concurrent updates');
}

export async function updateChatProjectLastConversationForUser(
  mongoose: typeof import('mongoose'),
  user: string,
  projectId: string,
  conversation: Pick<IConversation, 'conversationId' | 'createdAt' | 'updatedAt'>,
  incrementCount = false,
): Promise<void> {
  if (!isValidObjectIdString(projectId) || !conversation.conversationId) {
    return;
  }

  const lastConversationAt = conversation.updatedAt ?? conversation.createdAt ?? new Date();
  const lastConversationFields = {
    lastConversationAt,
    lastConversationId: conversation.conversationId,
  };
  const ChatProject = mongoose.models.ChatProject as Model<IChatProjectDocument>;
  const projectFilter = { _id: new mongoose.Types.ObjectId(projectId), user };

  if (!incrementCount) {
    await ChatProject.updateOne(projectFilter, { $set: lastConversationFields });
  } else {
    /**
     * Skip `$inc` when a concurrent refresh already recorded this conversation as
     * `lastConversationId`. The conversation is visible to countDocuments as soon
     * as it is persisted, so a later increment would double-count it.
     */
    const incremented = await ChatProject.updateOne(
      { ...projectFilter, lastConversationId: { $ne: conversation.conversationId } },
      { $set: lastConversationFields, $inc: { conversationCount: 1 } },
    );
    if ((incremented.matchedCount ?? 0) === 0) {
      await ChatProject.updateOne(projectFilter, { $set: lastConversationFields });
    }
  }

  /**
   * The chat can stop being visible while this pointer write is in flight: an archive-all
   * sweep, a single archive from another tab, or a retention flip, each of which has
   * already run its own stats refresh by the time this lands, leaving the project
   * advertising activity on a chat its workspace hides. Checking first would only move
   * that race earlier, so the pointer is verified after it is written and the project
   * recomputed when the chat it names turns out to be hidden. A sweep that lands later
   * still refreshes the project itself, and `refreshChatProjectStatsForUser` compare-and-
   * sets, so it cannot commit a count it read before this write. The read is a point
   * lookup on the unique `conversationId, user` index.
   */
  const Conversation = mongoose.models.Conversation as Model<IConversation>;
  const stillVisible = await Conversation.exists({
    ...visibleProjectConversationFilter(user, projectId),
    conversationId: conversation.conversationId,
  });
  if (!stillVisible) {
    await refreshChatProjectStatsForUser(mongoose, user, projectId);
  }
}

export function createChatProjectMethods(mongoose: typeof import('mongoose')): ChatProjectMethods {
  async function createChatProject(
    user: string,
    input: CreateChatProjectInput,
  ): Promise<IChatProject> {
    const ChatProject = mongoose.models.ChatProject as Model<IChatProjectDocument>;
    const sanitized = sanitizeProjectInput(input);
    if (!sanitized.name) {
      throw new Error('Project name is required');
    }

    const project = await ChatProject.create({
      ...sanitized,
      user,
      conversationCount: 0,
      lastConversationAt: null,
      lastConversationId: null,
    });
    return project.toObject() as IChatProject;
  }

  async function getChatProject(user: string, projectId: string): Promise<IChatProject | null> {
    if (!isValidObjectIdString(projectId)) {
      return null;
    }

    const ChatProject = mongoose.models.ChatProject as Model<IChatProjectDocument>;
    return await ChatProject.findOne({
      _id: new mongoose.Types.ObjectId(projectId),
      user,
    }).lean<IChatProject>();
  }

  async function listChatProjects(
    user: string,
    options: ListChatProjectsOptions = {},
  ): Promise<ListChatProjectsResult> {
    if (options.workspaceId != null && options.workspaceId !== '') {
      /** A malformed filter narrows to nothing rather than throwing, matching `listUsageRecords`. */
      if (!isValidObjectIdString(options.workspaceId)) {
        return { projects: [], nextCursor: null };
      }
      return await queryProjects(mongoose, { user, workspaceId: options.workspaceId }, options);
    }
    return await queryProjects(mongoose, { user }, options);
  }

  async function listWorkspaceChatProjects(
    workspaceId: string,
    options: ListChatProjectsOptions = {},
  ): Promise<ListChatProjectsResult> {
    if (!isValidObjectIdString(workspaceId)) {
      return { projects: [], nextCursor: null };
    }
    return await queryProjects(mongoose, { workspaceId }, options);
  }

  async function updateChatProject(
    user: string,
    projectId: string,
    input: UpdateChatProjectInput,
  ): Promise<IChatProject | null> {
    if (!isValidObjectIdString(projectId)) {
      return null;
    }

    const ChatProject = mongoose.models.ChatProject as Model<IChatProjectDocument>;
    const update: Partial<Pick<IChatProject, 'name' | 'description' | 'workspaceId'>> = {};
    const unset: { workspaceId?: '' } = {};
    if (typeof input.name === 'string') {
      const name = input.name.trim().slice(0, MAX_CHAT_PROJECT_NAME_LENGTH);
      if (!name) {
        throw new Error('Project name is required');
      }
      update.name = name;
    }
    if (input.description !== undefined) {
      update.description =
        input.description?.trim().slice(0, MAX_CHAT_PROJECT_DESCRIPTION_LENGTH) ?? '';
    }
    /** `null` detaches the project from its workspace; omitted leaves it alone. */
    if (input.workspaceId !== undefined) {
      const workspaceId = normalizeWorkspaceId(input.workspaceId);
      if (workspaceId != null) {
        update.workspaceId = workspaceId;
      } else {
        unset.workspaceId = '';
      }
    }

    const mutation = Object.keys(unset).length
      ? ({ $set: update, $unset: unset } as UpdateQuery<IChatProjectDocument>)
      : ({ $set: update } as UpdateQuery<IChatProjectDocument>);

    return await ChatProject.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(projectId), user },
      mutation,
      { new: true, runValidators: true },
    ).lean<IChatProject>();
  }

  async function deleteChatProject(
    user: string,
    projectId: string,
  ): Promise<DeleteChatProjectResult> {
    if (!isValidObjectIdString(projectId)) {
      return { deletedCount: 0, modifiedCount: 0 };
    }

    const ChatProject = mongoose.models.ChatProject as Model<IChatProjectDocument>;
    const Conversation = mongoose.models.Conversation as Model<IConversation>;
    const projectFilter = { _id: new mongoose.Types.ObjectId(projectId), user };
    const project = await ChatProject.findOne(projectFilter).select('_id').lean<IChatProject>();
    if (!project) {
      return { deletedCount: 0, modifiedCount: 0 };
    }

    const [conversationResult, deleteResult] = await Promise.all([
      Conversation.updateMany(
        { user, chatProjectId: projectId },
        { $unset: { chatProjectId: '' } },
      ),
      ChatProject.deleteOne(projectFilter),
    ]);

    return {
      deletedCount: deleteResult.deletedCount ?? 0,
      modifiedCount: conversationResult.modifiedCount ?? 0,
    };
  }

  async function assignConversationToProject(
    user: string,
    conversationId: string,
    projectId: string | null,
  ): Promise<AssignConversationToProjectResult | null> {
    const ChatProject = mongoose.models.ChatProject as Model<IChatProjectDocument>;
    const Conversation = mongoose.models.Conversation as Model<IConversation>;
    const conversation = await Conversation.findOne({ user, conversationId }).lean<IConversation>();
    if (!conversation) {
      return null;
    }

    const normalizedProjectId = projectId || null;
    if (normalizedProjectId) {
      if (!isValidObjectIdString(normalizedProjectId)) {
        throw new Error('Project not found');
      }
      const project = await ChatProject.findOne({
        _id: new mongoose.Types.ObjectId(normalizedProjectId),
        user,
      })
        .select('_id')
        .lean<IChatProject>();
      if (!project) {
        throw new Error('Project not found');
      }
    }

    const previousProjectId = conversation.chatProjectId ?? null;
    const update =
      normalizedProjectId == null
        ? { $unset: { chatProjectId: '' } }
        : { $set: { chatProjectId: normalizedProjectId } };
    const updatedConversation = await Conversation.findOneAndUpdate(
      { user, conversationId },
      update,
      { new: true },
    ).lean<IConversation>();

    if (!updatedConversation) {
      return null;
    }

    const projectIds = new Set(
      [previousProjectId, normalizedProjectId].filter((id): id is string => Boolean(id)),
    );
    await Promise.all(
      [...projectIds].map((id) => refreshChatProjectStatsForUser(mongoose, user, id)),
    );

    return {
      conversation: updatedConversation,
      previousProjectId,
      projectId: normalizedProjectId,
    };
  }

  async function refreshChatProjectStats(
    user: string,
    projectId: string,
  ): Promise<IChatProject | null> {
    return await refreshChatProjectStatsForUser(mongoose, user, projectId);
  }

  /**
   * Cross-entity palette search over project names. The listing path already
   * filters `name`/`description` with a bounded case-insensitive regex, so this
   * rides the same pattern on the stored `{ user, workspaceId }` index with a
   * hard cap (`limit <= 20`), matching only the requesting user's projects.
   */
  async function searchChatProjectsByTitle(
    user: string,
    query: string,
    limit?: number,
  ): Promise<ChatProjectTitleHit[]> {
    const trimmed = typeof query === 'string' ? query.trim() : '';
    if (!trimmed) {
      return [];
    }
    const pageSize = Number.isFinite(limit)
      ? Math.min(Math.max(Math.trunc(limit as number), 1), MAX_TITLE_SEARCH_LIMIT)
      : DEFAULT_TITLE_SEARCH_LIMIT;
    try {
      const ChatProject = mongoose.models.ChatProject as Model<IChatProjectDocument>;
      const searchRegex = { $regex: escapeRegExp(trimmed), $options: 'i' };
      return await ChatProject.find({
        user,
        $or: [{ name: searchRegex }, { description: searchRegex }],
      })
        .select('name lastConversationAt updatedAt')
        .sort({ updatedAt: -1, _id: -1 })
        .limit(pageSize)
        .lean<Array<Pick<ProjectLean, '_id' | 'name' | 'lastConversationAt' | 'updatedAt'>>>()
        .then((projects) =>
          projects.map((project) => ({
            id: project._id.toString(),
            name: project.name,
            lastConversationAt: project.lastConversationAt ?? null,
          })),
        );
    } catch (error) {
      logger.error('[searchChatProjectsByTitle] Error searching project titles', error);
      throw new Error('Error searching project titles');
    }
  }

  return {
    createChatProject,
    getChatProject,
    listChatProjects,
    listWorkspaceChatProjects,
    searchChatProjectsByTitle,
    updateChatProject,
    deleteChatProject,
    assignConversationToProject,
    refreshChatProjectStats,
  };
}
