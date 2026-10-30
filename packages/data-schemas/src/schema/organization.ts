import { Schema } from 'mongoose';
import type { IOrganizationDocument } from '~/types/organization';

const organizationSchema: Schema<IOrganizationDocument> = new Schema<IOrganizationDocument>(
  {
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
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
      required: true,
    },
    isPersonal: {
      type: Boolean,
      default: false,
    },
    settings: {
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

/** A slug names one organization per tenant. */
organizationSchema.index({ slug: 1, tenantId: 1 }, { unique: true });
organizationSchema.index({ owner: 1, createdAt: -1, _id: -1 });

export default organizationSchema;
