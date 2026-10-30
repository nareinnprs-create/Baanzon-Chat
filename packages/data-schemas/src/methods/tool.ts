import type { Model } from 'mongoose';
import type {
  ITool,
  IToolDocument,
  CreateToolInput,
  UpdateToolInput,
  ListToolsOptions,
} from '~/types/tool';
import { isValidObjectIdString } from '~/utils/objectId';

/** Longest tool name accepted, matching the schema's `maxlength`. */
export const TOOL_NAME_MAX_LENGTH = 200;

export interface ToolMethods {
  createTool(input: CreateToolInput): Promise<ITool>;
  getTool(toolId: string): Promise<ITool | null>;
  /** Looks a tool up by its tenant-unique name. */
  getToolByName(name: string): Promise<ITool | null>;
  listTools(options?: ListToolsOptions): Promise<ITool[]>;
  updateTool(toolId: string, patch: UpdateToolInput): Promise<ITool | null>;
  /** Removes the tool and cascades to its versions and grants. */
  deleteTool(toolId: string): Promise<boolean>;
}

export function createToolMethods(mongoose: typeof import('mongoose')): ToolMethods {
  const Tool = (): Model<IToolDocument> => mongoose.models.Tool as Model<IToolDocument>;

  async function createTool(input: CreateToolInput): Promise<ITool> {
    if (!isValidObjectIdString(input.createdBy)) {
      throw new Error('A valid createdBy is required');
    }
    const name = input.name?.trim();
    if (!name) {
      throw new Error('Tool name is required');
    }

    const created = await Tool().create({
      name,
      type: input.type,
      createdBy: input.createdBy,
      description: input.description,
      definition: input.definition,
      enabled: input.enabled ?? true,
    });
    return created.toObject() as ITool;
  }

  async function getTool(toolId: string): Promise<ITool | null> {
    if (!isValidObjectIdString(toolId)) {
      return null;
    }
    return await Tool().findById(toolId).lean<ITool>();
  }

  async function getToolByName(name: string): Promise<ITool | null> {
    const trimmed = name?.trim();
    if (!trimmed) {
      return null;
    }
    return await Tool().findOne({ name: trimmed }).lean<ITool>();
  }

  async function listTools(options?: ListToolsOptions): Promise<ITool[]> {
    const filter: { type?: string; enabled?: boolean } = {};
    if (options?.type !== undefined) {
      filter.type = options.type;
    }
    if (options?.enabledOnly) {
      filter.enabled = true;
    }
    return await Tool().find(filter).sort({ name: 1, _id: 1 }).lean<ITool[]>();
  }

  async function updateTool(toolId: string, patch: UpdateToolInput): Promise<ITool | null> {
    if (!isValidObjectIdString(toolId)) {
      return null;
    }

    const update: Partial<Pick<ITool, 'description' | 'definition' | 'enabled'>> = {};
    if (patch.description !== undefined) {
      update.description = patch.description;
    }
    if (patch.definition !== undefined) {
      update.definition = patch.definition;
    }
    if (patch.enabled !== undefined) {
      update.enabled = patch.enabled;
    }

    return await Tool()
      .findByIdAndUpdate(toolId, { $set: update }, { new: true, runValidators: true })
      .lean<ITool>();
  }

  async function deleteTool(toolId: string): Promise<boolean> {
    if (!isValidObjectIdString(toolId)) {
      return false;
    }

    const deleted = await Tool().findOneAndDelete({ _id: toolId });
    if (!deleted) {
      return false;
    }

    if (mongoose.models.ToolVersion) {
      await mongoose.models.ToolVersion.deleteMany({ toolId });
    }
    if (mongoose.models.ToolPermission) {
      await mongoose.models.ToolPermission.deleteMany({ toolId });
    }
    return true;
  }

  return { createTool, getTool, getToolByName, listTools, updateTool, deleteTool };
}
