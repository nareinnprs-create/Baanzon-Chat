import { Schema } from 'mongoose';
import type { IWorkflowDocument } from '~/types/workflow';

const workflowSchema: Schema<IWorkflowDocument> = new Schema<IWorkflowDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 200,
    },
    description: {
      type: String,
      maxlength: 2000,
    },
    definition: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    enabled: {
      type: Boolean,
      default: true,
      required: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

/** A slug names one workflow per tenant. */
workflowSchema.index({ slug: 1, tenantId: 1 }, { unique: true });
/** Workflows are browsed newest first, optionally filtered by availability. */
workflowSchema.index({ enabled: 1, createdAt: -1, _id: -1 });

export default workflowSchema;
