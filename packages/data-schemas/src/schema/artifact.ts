import { Schema } from 'mongoose';
import type { IArtifactDocument } from '~/types/artifact';

const artifactSchema: Schema<IArtifactDocument> = new Schema<IArtifactDocument>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    type: {
      type: String,
      enum: ['code', 'document', 'html', 'image', 'data', 'other'],
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    conversationId: {
      type: String,
      index: true,
    },
    currentVersion: {
      type: Number,
      default: 0,
      min: 0,
      required: true,
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

/** A user's artifact library, newest first. */
artifactSchema.index({ user: 1, createdAt: -1, _id: -1 });
/** Artifacts produced inside one conversation. */
artifactSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });

export default artifactSchema;
