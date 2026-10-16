import type { Document, Types } from 'mongoose';

/** Lifecycle of a single workflow execution. */
export type WorkflowRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * A single execution of a workflow (blueprint §45 `workflow_runs`).
 *
 * One row per run, updated in place from `pending` through a terminal state.
 * Runs are owner-scoped and tenant-scoped; `runId` is caller-supplied so a
 * retried dispatch is idempotent rather than a second run.
 */
export interface IWorkflowRun {
  _id?: Types.ObjectId;
  /** Caller-supplied run id, unique within the tenant. */
  runId: string;
  workflowId: Types.ObjectId;
  /** The user who triggered the run. */
  user: Types.ObjectId;
  status: WorkflowRunStatus;
  error?: string;
  startedAt?: Date;
  finishedAt?: Date;
  /** Run metadata; opaque to this package. */
  metadata?: Record<string, unknown>;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IWorkflowRunDocument extends Omit<IWorkflowRun, '_id'>, Document {}

export interface StartWorkflowRunInput {
  runId: string;
  workflowId: string;
  user: string;
  metadata?: Record<string, unknown>;
}

export interface CompleteWorkflowRunInput {
  status: Extract<WorkflowRunStatus, 'succeeded' | 'failed' | 'cancelled'>;
  error?: string;
}

export interface ListWorkflowRunsOptions {
  status?: WorkflowRunStatus;
  limit?: number;
}
