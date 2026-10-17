import type { Document, Types } from 'mongoose';

/** The kind of deliverable an artifact holds. */
export type ArtifactType = 'code' | 'document' | 'html' | 'image' | 'data' | 'other';

/**
 * A named, versioned deliverable (blueprint §45 `artifacts`).
 *
 * The artifact row is the stable identity and metadata; its contents live in
 * `artifact_versions`, one row per revision. `currentVersion` is the highest
 * revision written so far and is `0` until the first revision lands.
 */
export interface IArtifact {
  _id?: Types.ObjectId;
  title: string;
  type: ArtifactType;
  /** The user who owns the artifact. */
  user: Types.ObjectId;
  conversationId?: string;
  /** Highest version written so far; 0 before the first revision. */
  currentVersion: number;
  /** Type-specific metadata; opaque to this package. */
  metadata?: Record<string, unknown>;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IArtifactDocument extends Omit<IArtifact, '_id'>, Document {}

export interface CreateArtifactInput {
  title: string;
  type: ArtifactType;
  user: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateArtifactInput {
  title?: string;
  metadata?: Record<string, unknown>;
}
