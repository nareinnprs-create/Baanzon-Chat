import { Schema } from 'mongoose';
import type { IWorkspaceDocument } from '~/types/workspace';

const workspaceSchema: Schema<IWorkspaceDocument> = new Schema<IWorkspaceDocument>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 200,
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000,
    },
    visibility: {
      type: String,
      enum: ['private', 'org'],
      default: 'org',
      required: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

/** A workspace slug is unique within its organization. */
workspaceSchema.index({ organizationId: 1, slug: 1 }, { unique: true });
workspaceSchema.index({ organizationId: 1, createdAt: -1, _id: -1 });

export default workspaceSchema;
