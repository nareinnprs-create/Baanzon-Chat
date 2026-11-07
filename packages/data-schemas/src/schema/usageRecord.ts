import { Schema } from 'mongoose';
import type { IUsageRecordDocument } from '~/types/usageRecord';

const usageRecordSchema: Schema<IUsageRecordDocument> = new Schema<IUsageRecordDocument>(
  {
    scope: {
      type: String,
      enum: ['user', 'organization', 'workspace'],
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      index: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    value: {
      type: Number,
      required: true,
      min: 0,
    },
    unit: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    recordedAt: {
      type: Date,
      required: true,
      default: Date.now,
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

usageRecordSchema.index({ scope: 1, key: 1, recordedAt: -1 });
usageRecordSchema.index({ userId: 1, key: 1, recordedAt: -1 });
usageRecordSchema.index({ organizationId: 1, key: 1, recordedAt: -1 });
usageRecordSchema.index({ workspaceId: 1, key: 1, recordedAt: -1 });

export default usageRecordSchema;
