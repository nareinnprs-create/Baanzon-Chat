import { Model } from 'mongoose';
import type { INotificationDocument } from '~/types/notification';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import notificationSchema from '~/schema/notification';

export function createNotificationModel(
  mongoose: typeof import('mongoose'),
): Model<INotificationDocument> {
  applyTenantIsolation(notificationSchema);
  return (
    mongoose.models.Notification ||
    mongoose.model<INotificationDocument>('Notification', notificationSchema, 'notifications')
  );
}
