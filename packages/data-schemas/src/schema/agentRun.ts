import { Schema } from 'mongoose';
import type { IAgentRunDocument } from '~/types/agentRun';

const agentRunSchema: Schema<IAgentRunDocument> = new Schema<IAgentRunDocument>(
  {
    runId: {
      type: String,
      required: true,
    },
    agentId: {
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
    conversationId: {
      type: String,
    },
    messageId: {
      type: String,
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
    inputTokens: {
      type: Number,
      min: 0,
    },
    outputTokens: {
      type: Number,
      min: 0,
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
agentRunSchema.index({ runId: 1, tenantId: 1 }, { unique: true });
agentRunSchema.index({ user: 1, createdAt: -1, _id: -1 });
agentRunSchema.index({ agentId: 1, createdAt: -1, _id: -1 });

export default agentRunSchema;
