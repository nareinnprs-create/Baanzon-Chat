import { Schema } from 'mongoose';
import type { IToolDocument } from '~/types/tool';

const toolSchema: Schema<IToolDocument> = new Schema<IToolDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      maxlength: 2000,
    },
    type: {
      type: String,
      enum: ['native', 'mcp', 'action', 'custom'],
      required: true,
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

/** A tool name names one tool per tenant. */
toolSchema.index({ name: 1, tenantId: 1 }, { unique: true });
/** The tool catalog is browsed by kind and availability. */
toolSchema.index({ type: 1, enabled: 1 });

export default toolSchema;
