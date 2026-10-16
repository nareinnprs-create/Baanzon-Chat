import { Schema } from 'mongoose';
import type { IWorkflowRunDocument } from '~/types/workflowRun';

const workflowRunSchema: Schema<IWorkflowRunDocument> = new Schema<IWorkflowRunDocument>(
  {
    runId: {
      type: String,
      required: true,
    },
    workflowId: {
      type: Schema.Types.ObjectId,
      ref: 'Workflow',
      required: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled'],
      default: 'pending',
      required: true,
    },
    error: {
      type: String,
    },
    startedAt: {
      type: Date,
    },
    finishedAt: {
      type: Date,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

/** A run id names one run per tenant. */
workflowRunSchema.index({ runId: 1, tenantId: 1 }, { unique: true });
/** Runs are listed per workflow and per user, newest first. */
workflowRunSchema.index({ workflowId: 1, createdAt: -1, _id: -1 });
workflowRunSchema.index({ user: 1, createdAt: -1, _id: -1 });

export default workflowRunSchema;
