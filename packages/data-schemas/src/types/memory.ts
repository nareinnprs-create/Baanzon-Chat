import type { Types, Document } from 'mongoose';

/**
 * Pointer from a memory row to its vector in the durable vector store
 * (Decision A4: Mongo stays primary, pgvector holds the embeddings). Storing
 * only the pointer keeps this package free of any vector-store dependency while
 * letting a memory be re-embedded or dropped without a cross-store join.
 */
export interface MemoryEmbedding {
  /** Identifier of the vector in the durable store. */
  vectorId: string;
  /** Embedding model that produced the vector, for re-embedding decisions. */
  model?: string;
  dimensions?: number;
  embeddedAt?: Date;
}

// Base memory interfaces
export interface IMemoryEntry extends Document {
  userId: Types.ObjectId;
  key: string;
  value: string;
  /** Agent partition; null/absent = shared personal pool */
  agentId?: string;
  tokenCount?: number;
  updated_at?: Date;
  tenantId?: string;
  /** Durable vector-store pointer; absent until the memory has been embedded. */
  embedding?: MemoryEmbedding;
}

export interface IMemoryEntryLean {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  key: string;
  value: string;
  agentId?: string;
  tokenCount?: number;
  updated_at?: Date;
  __v?: number;
  embedding?: MemoryEmbedding;
}

// Method parameter interfaces
export interface SetMemoryParams {
  userId: string | Types.ObjectId;
  key: string;
  value: string;
  tokenCount?: number;
  /** Agent partition; omit for the shared personal pool */
  agentId?: string;
}

export interface DeleteMemoryParams {
  userId: string | Types.ObjectId;
  key: string;
  agentId?: string;
}

export interface MemoryByIdParams {
  userId: string | Types.ObjectId;
  id: string;
  agentId?: string;
}

export interface SetMemoryByIdParams extends MemoryByIdParams {
  /** Omit to preserve the existing key. */
  key?: string;
  value: string;
  tokenCount?: number;
}

export interface GetUserMemoriesParams {
  userId: string | Types.ObjectId;
  agentId?: string;
}

export interface GetFormattedMemoriesParams {
  userId: string | Types.ObjectId;
  agentId?: string;
}

export interface SetMemoryEmbeddingParams {
  userId: string | Types.ObjectId;
  /** The memory's `_id`. */
  id: string;
  /** Identifier of the vector in the durable vector store. */
  vectorId: string;
  model?: string;
  dimensions?: number;
}

// Result interfaces
export interface MemoryResult {
  ok: boolean;
}

export interface SetMemoryByIdResult extends MemoryResult {
  conflict?: boolean;
  memory?: IMemoryEntryLean;
}

export interface SetMemoryEmbeddingResult extends MemoryResult {
  memory?: IMemoryEntryLean;
}

export interface FormattedMemoriesResult {
  withKeys: string;
  withoutKeys: string;
  totalTokens?: number;
  tokenCountsByKey?: Map<string, number>;
}
