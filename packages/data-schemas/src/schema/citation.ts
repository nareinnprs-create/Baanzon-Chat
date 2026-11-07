import { Schema } from 'mongoose';
import type { ICitationDocument } from '~/types/citation';

const citationSchema: Schema<ICitationDocument> = new Schema<ICitationDocument>(
  {
    sourceId: {
      type: Schema.Types.ObjectId,
      ref: 'Source',
      required: true,
      index: true,
    },
    messageId: {
      type: String,
      required: true,
      index: true,
    },
    conversationId: {
      type: String,
      required: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    index: {
      type: Number,
      required: true,
      min: 0,
    },
    quote: {
      type: String,
      maxlength: 4000,
    },
    score: {
      type: Number,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

/** A message has at most one citation per index. */
citationSchema.index({ messageId: 1, index: 1 }, { unique: true });
/** Listing a conversation's citations is the read path. */
citationSchema.index({ conversationId: 1, messageId: 1, index: 1 });

export default citationSchema;
