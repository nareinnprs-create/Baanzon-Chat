import type { Model } from 'mongoose';
import type {
  IToolVersion,
  IToolVersionDocument,
  CreateToolVersionInput,
  ListToolVersionsOptions,
} from '~/types/toolVersion';
import { isValidObjectIdString } from '~/utils/objectId';

/** Hard cap on how many revisions one listing returns. */
export const TOOL_VERSION_LIST_MAX_LIMIT = 100;

function normalizeLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    return TOOL_VERSION_LIST_MAX_LIMIT;
  }
  return Math.min(Math.floor(limit), TOOL_VERSION_LIST_MAX_LIMIT);
}

export interface ToolVersionMethods {
  /** Appends the next revision for the tool and returns it. */
  createToolVersion(input: CreateToolVersionInput): Promise<IToolVersion>;
  getToolVersion(toolId: string, version: number): Promise<IToolVersion | null>;
  getLatestToolVersion(toolId: string): Promise<IToolVersion | null>;
  /** Newest revision first. */
  listToolVersions(toolId: string, options?: ListToolVersionsOptions): Promise<IToolVersion[]>;
  /** Removes every revision of a tool; returns how many were dropped. */
  deleteToolVersionsForTool(toolId: string): Promise<number>;
}

export function createToolVersionMethods(
  mongoose: typeof import('mongoose'),
): ToolVersionMethods {
  const ToolVersion = (): Model<IToolVersionDocument> =>
    mongoose.models.ToolVersion as Model<IToolVersionDocument>;

  async function createToolVersion(input: CreateToolVersionInput): Promise<IToolVersion> {
    if (!isValidObjectIdString(input.toolId)) {
      throw new Error('A valid toolId is required');
    }
    if (!isValidObjectIdString(input.createdBy)) {
      throw new Error('A valid createdBy is required');
    }

    const latest = await ToolVersion()
      .findOne({ toolId: input.toolId })
      .sort({ version: -1 })
      .select('version')
      .lean<Pick<IToolVersion, 'version'>>();

    const created = await ToolVersion().create({
      toolId: input.toolId,
      version: (latest?.version ?? 0) + 1,
      definition: input.definition,
      description: input.description,
      changelog: input.changelog,
      createdBy: input.createdBy,
    });
    return created.toObject() as IToolVersion;
  }

  async function getToolVersion(toolId: string, version: number): Promise<IToolVersion | null> {
    if (!isValidObjectIdString(toolId) || !Number.isInteger(version)) {
      return null;
    }
    return await ToolVersion().findOne({ toolId, version }).lean<IToolVersion>();
  }

  async function getLatestToolVersion(toolId: string): Promise<IToolVersion | null> {
    if (!isValidObjectIdString(toolId)) {
      return null;
    }
    return await ToolVersion().findOne({ toolId }).sort({ version: -1 }).lean<IToolVersion>();
  }

  async function listToolVersions(
    toolId: string,
    options?: ListToolVersionsOptions,
  ): Promise<IToolVersion[]> {
    if (!isValidObjectIdString(toolId)) {
      return [];
    }
    return await ToolVersion()
      .find({ toolId })
      .sort({ version: -1, _id: -1 })
      .limit(normalizeLimit(options?.limit))
      .lean<IToolVersion[]>();
  }

  async function deleteToolVersionsForTool(toolId: string): Promise<number> {
    if (!isValidObjectIdString(toolId)) {
      return 0;
    }
    const result = await ToolVersion().deleteMany({ toolId });
    return result.deletedCount ?? 0;
  }

  return {
    createToolVersion,
    getToolVersion,
    getLatestToolVersion,
    listToolVersions,
    deleteToolVersionsForTool,
  };
}
