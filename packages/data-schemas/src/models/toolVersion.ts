import { Model } from 'mongoose';
import type { IToolVersionDocument } from '~/types/toolVersion';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import toolVersionSchema from '~/schema/toolVersion';

export function createToolVersionModel(
  mongoose: typeof import('mongoose'),
): Model<IToolVersionDocument> {
  applyTenantIsolation(toolVersionSchema);
  return (
    mongoose.models.ToolVersion ||
    mongoose.model<IToolVersionDocument>('ToolVersion', toolVersionSchema, 'tool_versions')
  );
}
