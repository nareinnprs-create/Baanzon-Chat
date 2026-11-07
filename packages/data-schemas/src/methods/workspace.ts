import type { Model } from 'mongoose';
import type {
  IWorkspace,
  IWorkspaceDocument,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
} from '~/types/workspace';
import { isValidObjectIdString } from '~/utils/objectId';

/** Longest slug accepted, matching the schema's `maxlength`. */
export const WORKSPACE_SLUG_MAX_LENGTH = 200;

/** Lowercases and dashes a human name into a URL-safe slug. */
export function slugifyWorkspaceName(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, WORKSPACE_SLUG_MAX_LENGTH);
}

export interface WorkspaceMethods {
  createWorkspace(input: CreateWorkspaceInput): Promise<IWorkspace>;
  getWorkspace(workspaceId: string): Promise<IWorkspace | null>;
  listWorkspaces(organizationId: string): Promise<IWorkspace[]>;
  updateWorkspace(workspaceId: string, patch: UpdateWorkspaceInput): Promise<IWorkspace | null>;
  deleteWorkspace(workspaceId: string): Promise<boolean>;
}

export function createWorkspaceMethods(mongoose: typeof import('mongoose')): WorkspaceMethods {
  const Workspace = (): Model<IWorkspaceDocument> =>
    mongoose.models.Workspace as Model<IWorkspaceDocument>;

  async function createWorkspace(input: CreateWorkspaceInput): Promise<IWorkspace> {
    if (!isValidObjectIdString(input.organizationId)) {
      throw new Error('A valid organizationId is required');
    }
    const name = input.name?.trim();
    if (!name) {
      throw new Error('Workspace name is required');
    }

    const created = await Workspace().create({
      organizationId: input.organizationId,
      name,
      slug: slugifyWorkspaceName(input.slug?.trim() || name) || 'workspace',
      description: input.description,
      visibility: input.visibility ?? 'org',
      createdBy: input.createdBy,
    });
    return created.toObject() as IWorkspace;
  }

  async function getWorkspace(workspaceId: string): Promise<IWorkspace | null> {
    if (!isValidObjectIdString(workspaceId)) {
      return null;
    }
    return await Workspace().findById(workspaceId).lean<IWorkspace>();
  }

  async function listWorkspaces(organizationId: string): Promise<IWorkspace[]> {
    if (!isValidObjectIdString(organizationId)) {
      return [];
    }
    return await Workspace()
      .find({ organizationId })
      .sort({ createdAt: -1, _id: -1 })
      .lean<IWorkspace[]>();
  }

  async function updateWorkspace(
    workspaceId: string,
    patch: UpdateWorkspaceInput,
  ): Promise<IWorkspace | null> {
    if (!isValidObjectIdString(workspaceId)) {
      return null;
    }

    const update: Partial<Pick<IWorkspace, 'name' | 'description' | 'visibility'>> = {};
    if (typeof patch.name === 'string') {
      const name = patch.name.trim();
      if (!name) {
        throw new Error('Workspace name is required');
      }
      update.name = name;
    }
    if (patch.description !== undefined) {
      update.description = patch.description;
    }
    if (patch.visibility !== undefined) {
      update.visibility = patch.visibility;
    }

    return await Workspace()
      .findByIdAndUpdate(workspaceId, { $set: update }, { new: true, runValidators: true })
      .lean<IWorkspace>();
  }

  async function deleteWorkspace(workspaceId: string): Promise<boolean> {
    if (!isValidObjectIdString(workspaceId)) {
      return false;
    }
    const result = await Workspace().deleteOne({ _id: workspaceId });
    return result.deletedCount === 1;
  }

  return {
    createWorkspace,
    getWorkspace,
    listWorkspaces,
    updateWorkspace,
    deleteWorkspace,
  };
}
