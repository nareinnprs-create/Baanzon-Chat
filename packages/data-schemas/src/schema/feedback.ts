import { Schema } from 'mongoose';
import type { IFeedbackDocument } from '~/types/feedback';

const feedbackSchema: Schema<IFeedbackDocument> = new Schema<IFeedbackDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 200,
    },
    type: {
      type: String,
      enum: ['bug', 'feature', 'improvement', 'general'],
      required: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },
    rating: {
      type: Number,
      min: 0,
      max: 5,
    },
    submittedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed'],
      default: 'open',
      required: true,
    },
    processedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

feedbackSchema.index({ status: 1, submittedAt: -1 });
feedbackSchema.index({ type: 1, status: 1 });
feedbackSchema.index({ userId: 1, submittedAt: -1 });

export default feedbackSchema;
