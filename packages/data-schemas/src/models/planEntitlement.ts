import { Model } from 'mongoose';
import type { IPlanEntitlementDocument } from '~/types/planEntitlement';
import planEntitlementSchema from '~/schema/planEntitlement';

export function createPlanEntitlementModel(
  mongoose: typeof import('mongoose'),
): Model<IPlanEntitlementDocument> {
  return (
    mongoose.models.PlanEntitlement ||
    mongoose.model<IPlanEntitlementDocument>(
      'PlanEntitlement',
      planEntitlementSchema,
      'plan_entitlements',
    )
  );
}
