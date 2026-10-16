import { Schema } from 'mongoose';
import type { IToolPermissionDocument } from '~/types/toolPermission';

const toolPermissionSchema: Schema<IToolPermissionDocument> = new Schema<IToolPermissionDocument>(
  {
    toolId: {
      type: Schema.Types.ObjectId,
      ref: 'Tool',
      required: true,
      index: true,
    },
    principalType: {
      type: String,
      enum: ['user', 'role', 'group'],
      required: true,
    },
    principalId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    granted: {
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

/** One grant row per tool and principal. */
toolPermissionSchema.index({ toolId: 1, principalType: 1, principalId: 1 }, { unique: true });
/** The effective grant set of a principal is a single indexed read. */
toolPermissionSchema.index({ principalType: 1, principalId: 1 });

export default toolPermissionSchema;
