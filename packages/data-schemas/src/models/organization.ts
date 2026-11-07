import { Model } from 'mongoose';
import type { IOrganizationDocument } from '~/types/organization';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import organizationSchema from '~/schema/organization';

export function createOrganizationModel(
  mongoose: typeof import('mongoose'),
): Model<IOrganizationDocument> {
  applyTenantIsolation(organizationSchema);
  return (
    mongoose.models.Organization ||
    mongoose.model<IOrganizationDocument>('Organization', organizationSchema, 'organizations')
  );
}
