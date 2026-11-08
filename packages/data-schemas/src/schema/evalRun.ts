import { Schema } from 'mongoose';
import { EVAL_RUN_STATUSES } from 'librechat-data-provider';
import type { IEvalRunDocument } from '~/types/evalRun';

const evalRunSchema: Schema<IEvalRunDocument> = new Schema<IEvalRunDocument>(
  {
    /** Exactly one of the two names the evaluated target (XOR enforced in methods). */
    agentId: {
      type: String,
      default: null,
    },
    workflowId: {
      type: String,
      default: null,
    },
    datasetName: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: EVAL_RUN_STATUSES,
      default: 'queued',
      required: true,
    },
    /** The dataset travels as JSON on the run; the scorer reads it back. */
    dataset: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    /** Per-case assertion results as JSON. */
    scores: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    error: {
      type: String,
      default: null,
    },
    startedAt: {
      type: Date,
    },
    finishedAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

/** Runs are listed per target, newest first. */
evalRunSchema.index({ agentId: 1, createdAt: -1, _id: -1 });
evalRunSchema.index({ workflowId: 1, createdAt: -1, _id: -1 });

export default evalRunSchema;
