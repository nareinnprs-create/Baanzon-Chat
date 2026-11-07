import { Model } from 'mongoose';
import type { IMessagePartDocument } from '~/types/messagePart';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import messagePartSchema from '~/schema/messagePart';

export function createMessagePartModel(
  mongoose: typeof import('mongoose'),
): Model<IMessagePartDocument> {
  applyTenantIsolation(messagePartSchema);
  return (
    mongoose.models.MessagePart ||
    mongoose.model<IMessagePartDocument>('MessagePart', messagePartSchema, 'message_parts')
  );
}
