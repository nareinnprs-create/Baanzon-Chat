/**
 * Durable `KnowledgeStore` backed by the `KnowledgeCollection` model
 * (blueprint §24 knowledge bases, §45 `knowledge_bases`).
 *
 * The store methods are injected rather than imported so the RAG domain keeps
 * its engine-free boundary: this module maps the domain's `KnowledgeCollection`
 * shape onto the data-schemas methods, and neither side sees the other's types.
 */
import type {
  KnowledgeStore,
  KnowledgeCollection,
  CollectionPatch,
  CollectionStatsDelta,
} from './types';

export interface MongoKnowledgeStoreDeps {
  createKnowledgeCollection(input: {
    id: string;
    userId: string;
    name: string;
    description?: string;
    scope: KnowledgeCollection['scope'];
    chunkSize: number;
    chunkOverlap: number;
  }): Promise<KnowledgeCollection>;
  getKnowledgeCollection(userId: string, collectionId: string): Promise<KnowledgeCollection | null>;
  listKnowledgeCollections(userId: string, limit?: number): Promise<KnowledgeCollection[]>;
  /**
   * Narrowed to the user-editable fields plus `updatedAt`: the ingest counters
   * arrive only through `bumpKnowledgeCollectionStats`, so the data-schemas
   * patch type must not widen them back in. A dependency signature that is
   * narrower than the methods it is handed is fine here — the adapter
   * forwards, it does not reinterpret.
   */
  updateKnowledgeCollection(
    userId: string,
    collectionId: string,
    patch: CollectionPatch & { updatedAt?: string },
  ): Promise<KnowledgeCollection | null>;
  bumpKnowledgeCollectionStats(
    userId: string,
    collectionId: string,
    delta: CollectionStatsDelta,
  ): Promise<KnowledgeCollection | null>;
  deleteKnowledgeCollection(userId: string, collectionId: string): Promise<boolean>;
}

export function createMongoKnowledgeStore(deps: MongoKnowledgeStoreDeps): KnowledgeStore {
  return {
    createCollection: (collection) => deps.createKnowledgeCollection(collection),
    getCollection: (userId, collectionId) => deps.getKnowledgeCollection(userId, collectionId),
    listCollections: (userId) => deps.listKnowledgeCollections(userId),
    updateCollection: (userId, collectionId, patch) =>
      deps.updateKnowledgeCollection(userId, collectionId, patch),
    bumpCollectionStats: (userId, collectionId, delta) =>
      deps.bumpKnowledgeCollectionStats(userId, collectionId, delta),
    deleteCollection: (userId, collectionId) =>
      deps.deleteKnowledgeCollection(userId, collectionId),
  };
}
