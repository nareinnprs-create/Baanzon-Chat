import type { Document, Types } from 'mongoose';

/**
 * One immutable revision of an artifact (blueprint §45 `artifact_versions`).
 *
 * Revisions are append-only: a new revision is its own row and the artifact's
 * `currentVersion` counter advances with it, so every prior deliverable stays
 * retrievable. `version` is a 1-based counter scoped to the artifact.
 */
export interface IArtifactVersion {
  _id?: Types.ObjectId;
  artifactId: Types.ObjectId;
  /** Monotonic 1-based revision number within the artifact. */
  version: number;
  content: string;
  /** Syntax hint for code artifacts, e.g. `typescript`; opaque otherwise. */
  language?: string;
  createdBy: Types.ObjectId;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IArtifactVersionDocument extends Omit<IArtifactVersion, '_id'>, Document {}

export interface CreateArtifactVersionInput {
  artifactId: string;
  createdBy: string;
  content: string;
  language?: string;
}

export interface ListArtifactVersionsOptions {
  limit?: number;
}
