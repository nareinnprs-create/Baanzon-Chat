/**
 * RAG / Knowledge domain — shared types.
 *
 * Provider-agnostic: callers inject the concrete `VectorStore` and
 * `KnowledgeStore` implementations (module-boundary rule), so this module
 * never imports a storage engine or the external RAG API client.
 */

/** Logical scope of a knowledge collection. */
export type CollectionScope = 'private' | 'project' | 'global';

/** Where a retrieval hit came from (hybrid merge labels). */
export type RetrievalSource = 'semantic' | 'keyword' | 'hybrid';

/** A knowledge collection: user-scoped, named grouping of embedded docs. */
export interface KnowledgeCollection {
  /** Unique id (uuid). */
  id: string;
  /** Owner user id. */
  userId: string;
  /** Display name (1–64 chars). */
  name: string;
  /** Optional description (<=512 chars). */
  description?: string;
  /** Logical scope; defaults to `private`. */
  scope: CollectionScope;
  /** Chunk size in characters (ingest-time). */
  chunkSize: number;
  /** Chunk overlap in characters (ingest-time). */
  chunkOverlap: number;
  /** Docs ingested. */
  documentCount: number;
  /** Chunks stored. */
  chunkCount: number;
  /** ISO timestamps. */
  updatedAt: string;
  createdAt: string;
}

/** One vector chunk (a retrieval-addressable unit) returned by stores. */
export interface VectorChunk {
  /** Collection id this chunk belongs to. */
  collectionId: string;
  /** Document id this chunk was carved from. */
  documentId: string;
  /** 0-based index within the document. */
  chunkIndex: number;
  /** Raw chunk text. */
  text: string;
  /** Provider-specific embedding (may be absent when the store embeds internally). */
  embedding?: number[];
  /** Document-level metadata (filename, source url, …). */
  metadata?: Record<string, unknown>;
}

/**
 * Vector store abstraction. Implementations: `InMemoryVectorStore`
 * (dev/tests, keyword fallback) or a RAG-API-backed adapter.
 */
export interface VectorStore {
  /** Upsert one chunk (replace by documentId+chunkIndex). */
  upsertChunk(collectionId: string, chunk: VectorChunk): Promise<void>;
  /** Bulk upsert. */
  upsertChunks(collectionId: string, chunks: VectorChunk[]): Promise<void>;
  /** Semantic search over one collection; returns chunks with best-match order. */
  semanticSearch(collectionId: string, query: string, limit: number): Promise<VectorChunk[]>;
  /** Remove all chunks of a document. */
  deleteDocument(collectionId: string, documentId: string): Promise<void>;
  /** Remove the whole collection. */
  deleteCollection(collectionId: string): Promise<void>;
}

/** Durable collection-metadata store (owner + mutable fields). */
export interface KnowledgeStore {
  createCollection(collection: KnowledgeCollection): Promise<KnowledgeCollection>;
  getCollection(userId: string, collectionId: string): Promise<KnowledgeCollection | null>;
  listCollections(userId: string): Promise<KnowledgeCollection[]>;
  updateCollection(
    userId: string,
    collectionId: string,
    patch: Partial<
      Pick<
        KnowledgeCollection,
        | 'name'
        | 'description'
        | 'scope'
        | 'documentCount'
        | 'chunkCount'
        | 'updatedAt'
      >
    >,
  ): Promise<KnowledgeCollection | null>;
  deleteCollection(userId: string, collectionId: string): Promise<boolean>;
}

/** Everything RagService needs; all injected per module-boundary rules. */
export interface RagServiceDeps {
  config: {
    chunkSize: number;
    chunkOverlap: number;
    hybridAlpha: number;
    candidateK: number;
    topK: number;
    minScore: number;
  };
  knowledgeStore: KnowledgeStore;
  vectorStore: VectorStore;
  /** Optional semantic client (external RAG API). Absent → keyword-only bridge. */
  semantic?: {
    search(collectionId: string, query: string, limit: number): Promise<VectorChunk[]>;
  };
}

export interface CreateCollectionParams {
  userId: string;
  name: string;
  description?: string;
  scope?: CollectionScope;
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface AddDocumentParams {
  userId: string;
  collectionId: string;
  /** Raw document text. */
  content: string;
  /** Source label (filename/url/title) for metadata. */
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface RetrieveParams {
  userId: string;
  collectionId: string;
  query: string;
  /** Hybrid balance override (0–1). */
  hybridAlpha?: number;
  topK?: number;
}

/** A single retrieval result returned to the agent/caller. */
export interface RetrievedSnippet {
  collectionId: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  score: number;
  /** Which retrieval path contributed (hybrid merge label). */
  source: RetrievalSource;
  metadata?: Record<string, unknown>;
}
