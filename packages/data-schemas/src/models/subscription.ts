import { Model } from 'mongoose';
import type { ISubscriptionDocument } from '~/types/subscription';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import subscriptionSchema from '~/schema/subscription';

export function createSubscriptionModel(
  mongoose: typeof import('mongoose'),
): Model<ISubscriptionDocument> {
  applyTenantIsolation(subscriptionSchema);
  return (
    mongoose.models.Subscription ||
    mongoose.model<ISubscriptionDocument>('Subscription', subscriptionSchema, 'subscriptions')
  );
}
