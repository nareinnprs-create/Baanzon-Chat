import type { Model } from 'mongoose';
import type {
  IWorkflowRun,
  IWorkflowRunDocument,
  WorkflowRunStatus,
  StartWorkflowRunInput,
  CompleteWorkflowRunInput,
  ListWorkflowRunsOptions,
} from '~/types/workflowRun';
import { isValidObjectIdString } from '~/utils/objectId';

/** Default page size for run listings. */
export const WORKFLOW_RUN_LIST_DEFAULT_LIMIT = 50;
/** Hard cap on a run listing page. */
export const WORKFLOW_RUN_LIST_MAX_LIMIT = 200;

function normalizeLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    return WORKFLOW_RUN_LIST_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), WORKFLOW_RUN_LIST_MAX_LIMIT);
}

export interface WorkflowRunMethods {
  /** Creates the run, or returns the existing one for a repeated `runId`. */
  startWorkflowRun(input: StartWorkflowRunInput): Promise<IWorkflowRun>;
  getWorkflowRun(userId: string, runId: string): Promise<IWorkflowRun | null>;
  markWorkflowRunRunning(userId: string, runId: string): Promise<IWorkflowRun | null>;
  /** Settles a run into a terminal state. */
  completeWorkflowRun(
    userId: string,
    runId: string,
    input: CompleteWorkflowRunInput,
  ): Promise<IWorkflowRun | null>;
  listWorkflowRunsForUser(
    userId: string,
    options?: ListWorkflowRunsOptions,
  ): Promise<IWorkflowRun[]>;
  listWorkflowRunsForWorkflow(
    workflowId: string,
    options?: ListWorkflowRunsOptions,
  ): Promise<IWorkflowRun[]>;
}

export function createWorkflowRunMethods(mongoose: typeof import('mongoose')): WorkflowRunMethods {
  const WorkflowRun = (): Model<IWorkflowRunDocument> =>
    mongoose.models.WorkflowRun as Model<IWorkflowRunDocument>;

  async function startWorkflowRun(input: StartWorkflowRunInput): Promise<IWorkflowRun> {
    if (!isValidObjectIdString(input.workflowId)) {
      throw new Error('A valid workflowId is required');
    }
    if (!isValidObjectIdString(input.user)) {
      throw new Error('A valid user is required');
    }

    const run = await WorkflowRun()
      .findOneAndUpdate(
        { runId: input.runId, user: input.user },
        {
          $setOnInsert: {
            runId: input.runId,
            workflowId: input.workflowId,
            user: input.user,
            status: 'pending',
            metadata: input.metadata,
            startedAt: new Date(),
          },
        },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      )
      .lean<IWorkflowRun>();
    if (!run) {
      throw new Error('Failed to start workflow run');
    }
    return run;
  }

  async function getWorkflowRun(userId: string, runId: string): Promise<IWorkflowRun | null> {
    if (!isValidObjectIdString(userId)) {
      return null;
    }
    return await WorkflowRun().findOne({ runId, user: userId }).lean<IWorkflowRun>();
  }

  async function markWorkflowRunRunning(
    userId: string,
    runId: string,
  ): Promise<IWorkflowRun | null> {
    if (!isValidObjectIdString(userId)) {
      return null;
    }
    return await WorkflowRun()
      .findOneAndUpdate(
        { runId, user: userId, status: { $in: ['pending', 'running'] } },
        { $set: { status: 'running' } },
        { new: true },
      )
      .lean<IWorkflowRun>();
  }

  async function completeWorkflowRun(
    userId: string,
    runId: string,
    input: CompleteWorkflowRunInput,
  ): Promise<IWorkflowRun | null> {
    if (!isValidObjectIdString(userId)) {
      return null;
    }

    const update: Partial<Pick<IWorkflowRun, 'status' | 'error' | 'finishedAt'>> = {
      status: input.status,
      finishedAt: new Date(),
    };
    if (input.error !== undefined) {
      update.error = input.error;
    }

    return await WorkflowRun()
      .findOneAndUpdate(
        { runId, user: userId },
        { $set: update },
        { new: true, runValidators: true },
      )
      .lean<IWorkflowRun>();
  }

  async function listWorkflowRunsForUser(
    userId: string,
    options?: ListWorkflowRunsOptions,
  ): Promise<IWorkflowRun[]> {
    if (!isValidObjectIdString(userId)) {
      return [];
    }
    const filter: { user: string; status?: WorkflowRunStatus } = { user: userId };
    if (options?.status !== undefined) {
      filter.status = options.status;
    }
    return await WorkflowRun()
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(normalizeLimit(options?.limit))
      .lean<IWorkflowRun[]>();
  }

  async function listWorkflowRunsForWorkflow(
    workflowId: string,
    options?: ListWorkflowRunsOptions,
  ): Promise<IWorkflowRun[]> {
    if (!isValidObjectIdString(workflowId)) {
      return [];
    }
    const filter: { workflowId: string; status?: WorkflowRunStatus } = { workflowId };
    if (options?.status !== undefined) {
      filter.status = options.status;
    }
    return await WorkflowRun()
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(normalizeLimit(options?.limit))
      .lean<IWorkflowRun[]>();
  }

  return {
    startWorkflowRun,
    getWorkflowRun,
    markWorkflowRunRunning,
    completeWorkflowRun,
    listWorkflowRunsForUser,
    listWorkflowRunsForWorkflow,
  };
}
