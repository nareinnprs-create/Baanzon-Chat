import type { Document, Types } from 'mongoose';

/** Where a source's content came from. */
export type SourceType = 'web' | 'file' | 'knowledge' | 'message' | 'tool';

/**
 * A retrievable source (blueprint §45 `sources`).
 *
 * A source is the provenance of one or more citations: the page, file or
 * knowledge chunk an answer drew from. Citations reference it by id so the
 * same source can back several spans of one or more messages.
 */
export interface ISource {
  _id?: Types.ObjectId;
  title: string;
  url?: string;
  type: SourceType;
  /** A short excerpt stored alongside the pointer for previews. */
  snippet?: string;
  /** The user whose request surfaced the source. */
  user: Types.ObjectId;
  conversationId?: string;
  /** Type-specific provenance; opaque to this package. */
  metadata?: Record<string, unknown>;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISourceDocument extends Omit<ISource, '_id'>, Document {}

export interface CreateSourceInput {
  title: string;
  type: SourceType;
  user: string;
  url?: string;
  snippet?: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}
