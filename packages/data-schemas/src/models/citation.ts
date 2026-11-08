import { Model } from 'mongoose';
import type { ICitationDocument } from '~/types/citation';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import citationSchema from '~/schema/citation';

export function createCitationModel(mongoose: typeof import('mongoose')): Model<ICitationDocument> {
  applyTenantIsolation(citationSchema);
  return (
    mongoose.models.Citation ||
    mongoose.model<ICitationDocument>('Citation', citationSchema, 'citations')
  );
}
