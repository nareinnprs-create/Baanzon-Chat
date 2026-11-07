import { Schema } from 'mongoose';
import type { IArtifactVersionDocument } from '~/types/artifactVersion';

const artifactVersionSchema: Schema<IArtifactVersionDocument> =
  new Schema<IArtifactVersionDocument>(
    {
      artifactId: {
        type: Schema.Types.ObjectId,
        ref: 'Artifact',
        required: true,
        index: true,
      },
      version: {
        type: Number,
        required: true,
        min: 1,
      },
      content: {
        type: String,
        required: true,
      },
      language: {
        type: String,
        maxlength: 100,
      },
      createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
      },
      tenantId: {
        type: String,
        index: true,
      },
    },
    { timestamps: true },
  );

/** An artifact has at most one row per revision number. */
artifactVersionSchema.index({ artifactId: 1, version: 1 }, { unique: true });
/** The newest revision of an artifact is the common read. */
artifactVersionSchema.index({ artifactId: 1, version: -1 });

export default artifactVersionSchema;
