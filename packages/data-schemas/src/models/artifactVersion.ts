import { Model } from 'mongoose';
import type { IArtifactVersionDocument } from '~/types/artifactVersion';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import artifactVersionSchema from '~/schema/artifactVersion';

export function createArtifactVersionModel(
  mongoose: typeof import('mongoose'),
): Model<IArtifactVersionDocument> {
  applyTenantIsolation(artifactVersionSchema);
  return (
    mongoose.models.ArtifactVersion ||
    mongoose.model<IArtifactVersionDocument>(
      'ArtifactVersion',
      artifactVersionSchema,
      'artifact_versions',
    )
  );
}
