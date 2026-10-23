import { Schema } from 'mongoose';
import type { ISourceDocument } from '~/types/source';

const sourceSchema: Schema<ISourceDocument> = new Schema<ISourceDocument>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    url: {
      type: String,
      maxlength: 2000,
    },
    type: {
      type: String,
      enum: ['web', 'file', 'knowledge', 'message', 'tool'],
      required: true,
    },
    snippet: {
      type: String,
      maxlength: 4000,
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

/** Listing the sources of a conversation is the read path. */
sourceSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
/** A user's source history, newest first. */
sourceSchema.index({ user: 1, createdAt: -1, _id: -1 });

export default sourceSchema;
