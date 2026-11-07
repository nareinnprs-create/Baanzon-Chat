import { Model } from 'mongoose';
import type { IToolDocument } from '~/types/tool';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import toolSchema from '~/schema/tool';

export function createToolModel(mongoose: typeof import('mongoose')): Model<IToolDocument> {
  applyTenantIsolation(toolSchema);
  return mongoose.models.Tool || mongoose.model<IToolDocument>('Tool', toolSchema, 'tools');
}
