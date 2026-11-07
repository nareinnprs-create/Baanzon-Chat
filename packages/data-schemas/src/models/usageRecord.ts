import { Model } from 'mongoose';
import type { IUsageRecordDocument } from '~/types/usageRecord';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import usageRecordSchema from '~/schema/usageRecord';

export function createUsageRecordModel(
  mongoose: typeof import('mongoose'),
): Model<IUsageRecordDocument> {
  applyTenantIsolation(usageRecordSchema);
  return (
    mongoose.models.UsageRecord ||
    mongoose.model<IUsageRecordDocument>('UsageRecord', usageRecordSchema, 'usage_records')
  );
}
