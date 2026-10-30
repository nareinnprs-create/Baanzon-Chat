import { Model } from 'mongoose';
import type { IFeedbackDocument } from '~/types/feedback';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import feedbackSchema from '~/schema/feedback';

export function createFeedbackModel(mongoose: typeof import('mongoose')): Model<IFeedbackDocument> {
  applyTenantIsolation(feedbackSchema);
  return (
    mongoose.models.Feedback ||
    mongoose.model<IFeedbackDocument>('Feedback', feedbackSchema, 'feedback')
  );
}
