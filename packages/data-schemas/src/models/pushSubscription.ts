import { Model } from 'mongoose';
import type { IPushSubscription } from '~/types/pushSubscription';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import pushSubscriptionSchema from '~/schema/pushSubscription';

export function createPushSubscriptionModel(
  mongoose: typeof import('mongoose'),
): Model<IPushSubscription> {
  applyTenantIsolation(pushSubscriptionSchema);
  return (
    mongoose.models.PushSubscription ||
    mongoose.model<IPushSubscription>('PushSubscription', pushSubscriptionSchema)
  );
}
