import { Model } from 'mongoose';
import type { ISourceDocument } from '~/types/source';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import sourceSchema from '~/schema/source';

export function createSourceModel(mongoose: typeof import('mongoose')): Model<ISourceDocument> {
  applyTenantIsolation(sourceSchema);
  return (
    mongoose.models.Source || mongoose.model<ISourceDocument>('Source', sourceSchema, 'sources')
  );
}
