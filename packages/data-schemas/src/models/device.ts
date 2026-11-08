import { Model } from 'mongoose';
import type { IDeviceDocument } from '~/types/device';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import deviceSchema from '~/schema/device';

export function createDeviceModel(mongoose: typeof import('mongoose')): Model<IDeviceDocument> {
  applyTenantIsolation(deviceSchema);
  return (
    mongoose.models.Device || mongoose.model<IDeviceDocument>('Device', deviceSchema, 'devices')
  );
}
