import { Schema } from 'mongoose';
import type { IToolVersionDocument } from '~/types/toolVersion';

const toolVersionSchema: Schema<IToolVersionDocument> = new Schema<IToolVersionDocument>(
  {
    toolId: {
      type: Schema.Types.ObjectId,
      ref: 'Tool',
      required: true,
      index: true,
    },
    version: {
      type: Number,
      required: true,
      min: 1,
    },
    definition: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    description: {
      type: String,
      maxlength: 2000,
    },
    changelog: {
      type: String,
      maxlength: 4000,
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

/** A tool has at most one row per revision number. */
toolVersionSchema.index({ toolId: 1, version: 1 }, { unique: true });
/** The newest revision of a tool is the common read. */
toolVersionSchema.index({ toolId: 1, version: -1 });

export default toolVersionSchema;
