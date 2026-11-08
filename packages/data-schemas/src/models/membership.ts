import { Model } from 'mongoose';
import type { IMembershipDocument } from '~/types/membership';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import membershipSchema from '~/schema/membership';

export function createMembershipModel(
  mongoose: typeof import('mongoose'),
): Model<IMembershipDocument> {
  applyTenantIsolation(membershipSchema);
  return (
    mongoose.models.Membership ||
    mongoose.model<IMembershipDocument>('Membership', membershipSchema, 'memberships')
  );
}
