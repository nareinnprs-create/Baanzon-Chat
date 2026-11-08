import type { TEvalCaseScore, TEvalDataset, TEvalRunStatus } from 'librechat-data-provider';
import type { Document } from 'mongoose';

/**
 * One evaluation run (blueprint §60, B22). Plain collection mirroring
 * `plan_entitlements`: the dataset and scores travel as JSON on the row, so no
 * boot migration is needed. Exactly one of `agentId` / `workflowId` names the
 * evaluated target.
 */
export interface IEvalRun {
  _id?: unknown;
  agentId?: string | null;
  workflowId?: string | null;
  datasetName: string;
  status: TEvalRunStatus;
  dataset?: TEvalDataset | null;
  scores?: TEvalCaseScore[] | null;
  /** Why the run failed - transport gaps, empty datasets, case failures. */
  error?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IEvalRunDocument extends Omit<IEvalRun, '_id'>, Document {}

export interface CreateEvalRunInput {
  agentId?: string;
  workflowId?: string;
  datasetName: string;
  dataset?: TEvalDataset;
}

export interface UpdateEvalRunResultInput {
  runId: string;
  /** `running` stamps `startedAt`; a terminal status stamps `finishedAt`. */
  status: Exclude<TEvalRunStatus, 'queued'>;
  scores?: TEvalCaseScore[];
  error?: string;
}

export interface ListEvalRunsParams {
  agentId?: string;
  workflowId?: string;
  limit?: number;
}
