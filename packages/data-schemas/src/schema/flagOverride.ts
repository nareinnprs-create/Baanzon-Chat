import { Schema } from 'mongoose';
import { FEATURE_FLAG_KEYS, FEATURE_FLAG_SCOPES } from 'librechat-data-provider';
import type { IFlagOverrideDocument } from '~/types/flagOverride';

const flagOverrideSchema: Schema<IFlagOverrideDocument> = new Schema<IFlagOverrideDocument>(
  {
    key: {
      type: String,
      required: true,
      enum: FEATURE_FLAG_KEYS,
    },
    scope: {
      type: String,
      required: true,
      enum: FEATURE_FLAG_SCOPES,
    },
    /** `organization` scope rows carry the org id; `global` rows omit it entirely. */
    scopeId: {
      type: String,
      default: null,
    },
    value: {
      type: Boolean,
      required: true,
    },
  },
  { timestamps: true },
);

flagOverrideSchema.index({ key: 1, scope: 1, scopeId: 1 }, { unique: true });

export default flagOverrideSchema;
