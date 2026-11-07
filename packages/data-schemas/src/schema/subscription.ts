import { Schema } from 'mongoose';
import type { ISubscriptionDocument } from '~/types/subscription';

const subscriptionSchema: Schema<ISubscriptionDocument> = new Schema<ISubscriptionDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    plan: {
      type: String,
      enum: ['free', 'basic', 'pro', 'enterprise'],
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'canceled', 'past_due', 'trialing', 'incomplete'],
      required: true,
      default: 'active',
    },
    stripeCustomerId: {
      type: String,
      trim: true,
      index: true,
    },
    stripeSubscriptionId: {
      type: String,
      trim: true,
      index: true,
    },
    priceId: {
      type: String,
      trim: true,
    },
    currentPeriodStart: {
      type: Date,
    },
    currentPeriodEnd: {
      type: Date,
    },
    cancelAt: {
      type: Date,
    },
    canceledAt: {
      type: Date,
    },
    trialEndsAt: {
      type: Date,
    },
    quantity: {
      type: Number,
      min: 0,
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

subscriptionSchema.index({ userId: 1, status: 1 });
subscriptionSchema.index({ userId: 1, plan: 1 });

export default subscriptionSchema;
