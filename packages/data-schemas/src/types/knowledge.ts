/**
 * Knowledge-collection types (blueprint §24 knowledge bases, §25 projects).
 *
 * Plain, engine-free shapes: the RAG domain in `packages/api` defines its own
 * structurally identical `KnowledgeCollection`, and the adapter in
 * `~/rag/knowledgeStore` maps between them. Keeping the two separate is what
 * stops the storage engine from becoming part of the RAG domain's public API.
 */

/**
 * Logical scope of a knowledge collection.
 *
 * `project` is absent, matching `CollectionScope` in `packages/api/src/rag`
 * and `TKnowledgeCollectionScope` in `packages/data-provider`. No visibility
 * rule honours it — `visibleToUser` here is owner-or-`global` — so it was a
 * value that could be written and never had an effect.
 *
 * This union is the *write* vocabulary, and a document stored with the retired
 * value before the refusal still reads back through `toPlain` unchanged: the
 * cast there is a plain re-typing of a Mongoose string, and narrowing a type
 * removes no rows. Such a row is owner-only, which is what it always was.
 */
export type KnowledgeScope = 'private' | 'global';

/**
 * Mutable fields of a knowledge collection.
 *
 * The counters are deliberately absent: they are maintained by ingest and
 * delete, so an absolute write here would silently drop a concurrent ingest's
 * increment even when every caller is careful today. They are reachable only
 * through `bumpKnowledgeCollectionStats`, which applies a signed delta in one
 * `$inc`. Kept structurally identical to the RAG domain's `CollectionPatch`
 * (`packages/api/src/rag/types.ts`) so the adapter forwards the patch without
 * widening it back in.
 */
export interface KnowledgeCollectionPatch {
  name?: string;
  description?: string;
  scope?: KnowledgeScope;
  updatedAt?: string;
}

export interface IKnowledgeCollection {
  /** Stable uuid assigned at creation. */
  id: string;
  /** Owning user id (string form; not an ObjectId ref). */
  userId: string;
  name: string;
  description?: string;
  scope: KnowledgeScope;
  /** Chunk size in characters, fixed at collection creation. */
  chunkSize: number;
  /** Chunk overlap in characters, fixed at collection creation. */
  chunkOverlap: number;
  documentCount: number;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Mongoose document shape (never leaves `packages/data-schemas`). */
export interface IKnowledgeCollectionDoc {
  id: string;
  userId: string;
  name: string;
  description?: string;
  scope: KnowledgeScope;
  chunkSize: number;
  chunkOverlap: number;
  documentCount: number;
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
  tenantId?: string;
}
