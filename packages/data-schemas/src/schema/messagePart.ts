import { Schema } from 'mongoose';
import type { IMessagePartDocument } from '~/types/messagePart';

const messagePartSchema: Schema<IMessagePartDocument> = new Schema<IMessagePartDocument>(
  {
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
      type: String,
      required: true,
      index: true,
    },
    index: {
      type: Number,
      required: true,
      min: 0,
    },
    type: {
      type: String,
      enum: ['text', 'reasoning', 'tool_call', 'tool_result', 'image', 'file'],
      required: true,
    },
    text: {
      type: String,
    },
    content: {
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

/** A message has at most one part per index. */
messagePartSchema.index({ messageId: 1, index: 1 }, { unique: true });
/** Listing a conversation's parts in order is the read path. */
messagePartSchema.index({ conversationId: 1, messageId: 1, index: 1 });

export default messagePartSchema;
