import { Model } from 'mongoose';
import type { IFlagOverrideDocument } from '~/types/flagOverride';
import flagOverrideSchema from '~/schema/flagOverride';

export function createFlagOverrideModel(
  mongoose: typeof import('mongoose'),
): Model<IFlagOverrideDocument> {
  return (
    mongoose.models.FlagOverride ||
    mongoose.model<IFlagOverrideDocument>('FlagOverride', flagOverrideSchema, 'flag_overrides')
  );
}
