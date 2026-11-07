import type { Document, Types } from 'mongoose';

/**
 * One immutable revision of a tool (blueprint §45 `tool_versions`).
 *
 * Revisions are append-only: editing a tool writes a new row instead of
 * mutating the declaration, so a run that resolved an older revision stays
 * reproducible. `version` is a 1-based counter scoped to the tool.
 */
export interface IToolVersion {
  _id?: Types.ObjectId;
  toolId: Types.ObjectId;
  /** Monotonic 1-based revision number within the tool. */
  version: number;
  /** Snapshot of the invocation contract at this revision. */
  definition?: Record<string, unknown>;
  description?: string;
  changelog?: string;
  createdBy: Types.ObjectId;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IToolVersionDocument extends Omit<IToolVersion, '_id'>, Document {}

export interface CreateToolVersionInput {
  toolId: string;
  createdBy: string;
  definition?: Record<string, unknown>;
  description?: string;
  changelog?: string;
}

export interface ListToolVersionsOptions {
  limit?: number;
}
