import type { Model } from 'mongoose';
import type {
  IWorkflow,
  IWorkflowDocument,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  ListWorkflowsOptions,
} from '~/types/workflow';
import { isValidObjectIdString } from '~/utils/objectId';

/** Longest slug accepted, matching the schema's `maxlength`. */
export const WORKFLOW_SLUG_MAX_LENGTH = 200;

/** Lowercases and dashes a human name into a URL-safe slug. */
export function slugifyWorkflowName(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, WORKFLOW_SLUG_MAX_LENGTH);
}

export interface WorkflowMethods {
  createWorkflow(input: CreateWorkflowInput): Promise<IWorkflow>;
  getWorkflow(workflowId: string): Promise<IWorkflow | null>;
  /** Looks a workflow up by its tenant-unique slug. */
  getWorkflowBySlug(slug: string): Promise<IWorkflow | null>;
  listWorkflows(options?: ListWorkflowsOptions): Promise<IWorkflow[]>;
  updateWorkflow(workflowId: string, patch: UpdateWorkflowInput): Promise<IWorkflow | null>;
  /** Removes the workflow and cascades to its runs. */
  deleteWorkflow(workflowId: string): Promise<boolean>;
}

export function createWorkflowMethods(mongoose: typeof import('mongoose')): WorkflowMethods {
  const Workflow = (): Model<IWorkflowDocument> =>
    mongoose.models.Workflow as Model<IWorkflowDocument>;

  async function createWorkflow(input: CreateWorkflowInput): Promise<IWorkflow> {
    if (!isValidObjectIdString(input.createdBy)) {
      throw new Error('A valid createdBy is required');
    }
    const name = input.name?.trim();
    if (!name) {
      throw new Error('Workflow name is required');
    }

    const created = await Workflow().create({
      name,
      slug: slugifyWorkflowName(input.slug?.trim() || name) || 'workflow',
      description: input.description,
      definition: input.definition,
      enabled: input.enabled ?? true,
      createdBy: input.createdBy,
    });
    return created.toObject() as IWorkflow;
  }

  async function getWorkflow(workflowId: string): Promise<IWorkflow | null> {
    if (!isValidObjectIdString(workflowId)) {
      return null;
    }
    return await Workflow().findById(workflowId).lean<IWorkflow>();
  }

  async function getWorkflowBySlug(slug: string): Promise<IWorkflow | null> {
    const trimmed = slug?.trim().toLowerCase();
    if (!trimmed) {
      return null;
    }
    return await Workflow().findOne({ slug: trimmed }).lean<IWorkflow>();
  }

  async function listWorkflows(options?: ListWorkflowsOptions): Promise<IWorkflow[]> {
    const filter: { enabled?: boolean } = {};
    if (options?.enabledOnly) {
      filter.enabled = true;
    }
    return await Workflow()
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .lean<IWorkflow[]>();
  }

  async function updateWorkflow(
    workflowId: string,
    patch: UpdateWorkflowInput,
  ): Promise<IWorkflow | null> {
    if (!isValidObjectIdString(workflowId)) {
      return null;
    }

    const update: Partial<
      Pick<IWorkflow, 'name' | 'description' | 'definition' | 'enabled'>
    > = {};
    if (typeof patch.name === 'string') {
      const name = patch.name.trim();
      if (!name) {
        throw new Error('Workflow name is required');
      }
      update.name = name;
    }
    if (patch.description !== undefined) {
      update.description = patch.description;
    }
    if (patch.definition !== undefined) {
      update.definition = patch.definition;
    }
    if (patch.enabled !== undefined) {
      update.enabled = patch.enabled;
    }

    return await Workflow()
      .findByIdAndUpdate(workflowId, { $set: update }, { new: true, runValidators: true })
      .lean<IWorkflow>();
  }

  async function deleteWorkflow(workflowId: string): Promise<boolean> {
    if (!isValidObjectIdString(workflowId)) {
      return false;
    }

    const deleted = await Workflow().findOneAndDelete({ _id: workflowId });
    if (!deleted) {
      return false;
    }

    if (mongoose.models.WorkflowRun) {
      await mongoose.models.WorkflowRun.deleteMany({ workflowId });
    }
    return true;
  }

  return {
    createWorkflow,
    getWorkflow,
    getWorkflowBySlug,
    listWorkflows,
    updateWorkflow,
    deleteWorkflow,
  };
}
