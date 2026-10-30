import { EVAL_RUN_STATUSES } from 'librechat-data-provider';
import type { FilterQuery, Model } from 'mongoose';
import type {
  CreateEvalRunInput,
  IEvalRun,
  IEvalRunDocument,
  ListEvalRunsParams,
  UpdateEvalRunResultInput,
} from '~/types/evalRun';
import { isValidObjectIdString } from '~/utils/objectId';

export const EVAL_RUN_LIST_DEFAULT_LIMIT = 25;
export const EVAL_RUN_LIST_MAX_LIMIT = 100;

const knownStatuses = new Set<string>(EVAL_RUN_STATUSES as readonly string[]);

export interface EvalRunMethods {
  /** Creates a run in the `queued` state; exactly one of agentId/workflowId. */
  createEvalRun(input: CreateEvalRunInput): Promise<IEvalRun>;
  /** The only sanctioned result writer: stamps started/finished time by status. */
  updateEvalRunResult(input: UpdateEvalRunResultInput): Promise<IEvalRun | null>;
  /** Fetches one run by id, or null when the id names nothing. */
  getEvalRunById(id: string): Promise<IEvalRun | null>;
  /** Lists runs per target (or all), newest first, capped. */
  listEvalRuns(params?: ListEvalRunsParams): Promise<IEvalRun[]>;
}

function resolveListLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return EVAL_RUN_LIST_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), EVAL_RUN_LIST_MAX_LIMIT);
}

export function createEvalRunMethods(mongoose: typeof import('mongoose')): EvalRunMethods {
  const EvalRun = (): Model<IEvalRunDocument> => mongoose.models.EvalRun as Model<IEvalRunDocument>;

  function validateTarget(input: CreateEvalRunInput): void {
    const hasAgent = typeof input.agentId === 'string' && input.agentId.length > 0;
    const hasWorkflow = typeof input.workflowId === 'string' && input.workflowId.length > 0;
    if (hasAgent === hasWorkflow) {
      throw new Error('An eval run needs exactly one target: agentId or workflowId');
    }
    if (hasAgent && !isValidObjectIdString(input.agentId as string)) {
      throw new Error('An eval run agentId must be a valid id');
    }
    if (hasWorkflow && !isValidObjectIdString(input.workflowId as string)) {
      throw new Error('An eval run workflowId must be a valid id');
    }
    if (typeof input.datasetName !== 'string' || input.datasetName.trim().length === 0) {
      throw new Error('An eval run requires a non-empty datasetName');
    }
  }

  async function createEvalRun(input: CreateEvalRunInput): Promise<IEvalRun> {
    validateTarget(input);

    const doc = await EvalRun().create({
      agentId: input.agentId ?? null,
      workflowId: input.workflowId ?? null,
      datasetName: input.datasetName,
      status: 'queued',
      dataset: input.dataset ?? null,
      scores: null,
      error: null,
    });
    return doc.toObject() as IEvalRun;
  }

  async function updateEvalRunResult(input: UpdateEvalRunResultInput): Promise<IEvalRun | null> {
    if (!isValidObjectIdString(input.runId)) {
      throw new Error('An eval run id must be a valid id');
    }
    if (!knownStatuses.has(input.status) || (input.status as string) === 'queued') {
      throw new Error('An eval run result update requires a non-queued status');
    }
    if (input.scores !== undefined && !Array.isArray(input.scores)) {
      throw new Error('Eval run scores must be an array');
    }

    const now = new Date();
    const set: Record<string, unknown> = { status: input.status };
    if (input.scores !== undefined) {
      set.scores = input.scores;
    }
    if (input.error !== undefined) {
      set.error = input.error;
    }
    if (input.status === 'running') {
      set.startedAt = now;
    } else {
      set.finishedAt = now;
    }

    const doc = await EvalRun().findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(input.runId) },
      { $set: set },
      { new: true },
    );
    return doc ? (doc.toObject() as IEvalRun) : null;
  }

  async function getEvalRunById(id: string): Promise<IEvalRun | null> {
    if (!isValidObjectIdString(id)) {
      return null;
    }
    const doc = await EvalRun().findById(new mongoose.Types.ObjectId(id));
    return doc ? (doc.toObject() as IEvalRun) : null;
  }

  async function listEvalRuns(params: ListEvalRunsParams = {}): Promise<IEvalRun[]> {
    const filter: FilterQuery<IEvalRunDocument> = {};
    if (params.agentId) {
      filter.agentId = params.agentId;
    }
    if (params.workflowId) {
      filter.workflowId = params.workflowId;
    }
    return await EvalRun()
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(resolveListLimit(params.limit))
      .lean<IEvalRun[]>();
  }

  return {
    createEvalRun,
    updateEvalRunResult,
    getEvalRunById,
    listEvalRuns,
  };
}
