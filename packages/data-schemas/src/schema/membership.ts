import { Schema } from 'mongoose';
import type { IMembershipDocument } from '~/types/membership';

const membershipSchema: Schema<IMembershipDocument> = new Schema<IMembershipDocument>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'member', 'viewer'],
      default: 'member',
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'invited', 'suspended'],
      default: 'active',
      required: true,
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: undefined,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

/** One membership per user per organization. */
membershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
/** Listing a user's organizations is the hot path for the sidebar. */
membershipSchema.index({ userId: 1, createdAt: -1, _id: -1 });

export default membershipSchema;
