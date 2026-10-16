import { Model } from 'mongoose';
import type { IArtifactDocument } from '~/types/artifact';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import artifactSchema from '~/schema/artifact';

export function createArtifactModel(mongoose: typeof import('mongoose')): Model<IArtifactDocument> {
  applyTenantIsolation(artifactSchema);
  return (
    mongoose.models.Artifact ||
    mongoose.model<IArtifactDocument>('Artifact', artifactSchema, 'artifacts')
  );
}
