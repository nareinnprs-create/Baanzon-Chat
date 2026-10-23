/**
 * RAG / Knowledge domain — shared types.
 *
 * Provider-agnostic: callers inject the concrete `VectorStore` and
 * `KnowledgeStore` implementations (module-boundary rule), so this module
 * never imports a storage engine or the external RAG API client.
 */

/**
 * Logical scope of a knowledge collection.
 *
 * `project` is absent deliberately, and the absence is load-bearing: no
 * visibility rule ever honoured it. `canAccessCollection` is owner-or-`global`,
 * so a collection created with `project` was stored and read back exactly like
 * a `private` one — a control that silently did nothing. Both gates now refuse
 * it (`validation.ts` with a 400, `canUseScope` with a 403), and keeping it in
 * the type would leave a caller able to compile a request that can only fail at
 * runtime, which is the defect the wider type was.
 *
 * The three definitions of this union — here, `KnowledgeScope` in
 * `packages/data-schemas` and `TKnowledgeCollectionScope` in
 * `packages/data-provider` — are the *write* vocabulary, and they agree. A row
 * written before the refusal can still carry the retired value in Mongo, since
 * narrowing a type deletes no documents: it reads back through
 * `canAccessCollection` as an ordinary owner-only collection, exactly as it
 * always did, and nothing in the read path filters, casts or drops it. It can
 * no longer be re-sent, which is the point.
 */
export type CollectionScope = 'private' | 'global';

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
  /**
   * Docs ingested — a durable ledger value, and only an estimate: the store
   * keeps no document index, so nothing can recount it. See the note on
   * {@link VectorStore.countChunks}.
   */
  documentCount: number;
  /**
   * Chunks stored. Durable ledger value written by ingest and delete; the
   * number the service *reports* is the store's own count, because the two can
   * legitimately disagree — see {@link VectorStore.countChunks}.
   */
  chunkCount: number;
  /** ISO timestamps. */
  updatedAt: string;
  createdAt: string;
}

/**
 * What a vector store can still accept, as the store itself counts it.
 *
 * The numbers that refuse a write are the ones the store keeps, so these come
 * from the store and nowhere else. A derived figure assembled from the durable
 * collection ledger would disagree with the 409 that actually fires — after a
 * restart the ledger still describes chunks a process-scoped index no longer
 * holds — and a client told "0 remaining" for a store with room in it is worse
 * off than one told nothing.
 *
 * `null` means *unbounded*, not *unknown*: an unbounded store can take anything.
 * A store that cannot report at all is absent from the interface, and the
 * response carries `null` for the whole object rather than zeroes that would
 * read as a full store.
 */
export interface VectorStoreCapacity {
  /** Chunks still acceptable; `null` when the store sets no chunk ceiling. */
  remainingChunks: number | null;
  /** Collections still acceptable; `null` when the store sets no collection ceiling. */
  remainingCollections: number | null;
}

/**
 * One collection listing: the page, plus enough to say what the page is.
 *
 * `total` is the count of everything the caller can see, not the length of the
 * page — the two are the same only when the page is uncapped, and a client that
 * conflates them is what makes a capped list read as a complete one. `hasMore`
 * is the precomputed form of the same fact, so a caller can branch on one
 * boolean without repeating the comparison (and without needing to know that
 * `total` is a count and not a limit).
 */
export interface KnowledgeCollectionListing {
  collections: KnowledgeCollection[];
  /** Every collection visible to the caller, page or no page. */
  total: number;
  /** `total` exceeds the returned page. */
  hasMore: boolean;
  /** What the vector index can still accept, or `null` when it does not report. */
  capacity: VectorStoreCapacity | null;
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
 *
 * The two stores behind this interface do not share a lifetime. The
 * collection metadata — including its `documentCount`/`chunkCount` ledger —
 * is durable (Mongo), while a process-scoped index such as
 * `InMemoryVectorStore` starts empty on every restart. So after a restart the
 * ledger describes vectors that no longer exist, and a delete of one of those
 * documents removes nothing and cannot walk the counters back down. This
 * interface therefore carries {@link countChunks}: the service reports the
 * store's real count rather than the ledger's, and warns when a write finds
 * the two disagree. Reconciling them (a rebuild, or a durable index) is a
 * deployment concern, not something a read can do.
 */
export interface VectorStore {
  /** Upsert one chunk (replace by documentId+chunkIndex). */
  upsertChunk(collectionId: string, chunk: VectorChunk): Promise<void>;
  /** Bulk upsert. */
  upsertChunks(collectionId: string, chunks: VectorChunk[]): Promise<void>;
  /** Semantic search over one collection; returns chunks with best-match order. */
  semanticSearch(collectionId: string, query: string, limit: number): Promise<VectorChunk[]>;
  /**
   * Remove all chunks of a document.
   * @returns how many chunks were removed; 0 means the document was not present,
   *          which callers need in order to keep their counters honest.
   */
  deleteDocument(collectionId: string, documentId: string): Promise<number>;
  /** Remove the whole collection. */
  deleteCollection(collectionId: string): Promise<void>;
  /**
   * Chunks this store actually holds for a collection — 0 for one it has never
   * seen. The authoritative counterpart to the metadata ledger, and the only
   * way a reader can tell an empty collection from a lost index.
   */
  countChunks(collectionId: string): Promise<number>;
  /**
   * What this store can still accept, or `undefined` when it cannot say.
   *
   * Optional because a store that is not bounded by this process — a hosted
   * index, a database-backed one — has no such number to give, and reporting
   * one it invented would be the false-`0` case {@link VectorStoreCapacity}
   * describes. A deployment whose store refuses writes with a 409 is exactly
   * the deployment where this is worth implementing; a client that gets
   * `undefined` keeps today's behaviour and the 409 as its only signal.
   */
  capacity?(): VectorStoreCapacity;
}

/**
 * Fields a client may change on a collection. The derived counters are
 * deliberately absent: they are maintained by ingest and delete, so accepting
 * them from a request would let a caller invent its own document count.
 */
export type CollectionPatch = Partial<Pick<KnowledgeCollection, 'name' | 'description' | 'scope'>>;

/** Signed change to the ingest counters, applied atomically by the store. */
export interface CollectionStatsDelta {
  documentDelta: number;
  chunkDelta: number;
}

/** Durable collection-metadata store (owner + mutable fields). */
export interface KnowledgeStore {
  createCollection(collection: KnowledgeCollection): Promise<KnowledgeCollection>;
  getCollection(userId: string, collectionId: string): Promise<KnowledgeCollection | null>;
  listCollections(userId: string): Promise<KnowledgeCollection[]>;
  /**
   * Owner-only writes; non-owners get `null` regardless of the patch. The
   * patch carries no counters: they move only through
   * {@link KnowledgeStore.bumpCollectionStats}, so a caller cannot write one
   * absolutely and lose a concurrent ingest's increment.
   */
  updateCollection(
    userId: string,
    collectionId: string,
    patch: CollectionPatch & { updatedAt?: string },
  ): Promise<KnowledgeCollection | null>;
  /**
   * Apply a signed delta to the ingest counters in one atomic operation. The
   * service must not compute counters from a value it read earlier: two
   * concurrent ingests for the same collection would otherwise overwrite each
   * other and silently lose increments.
   */
  bumpCollectionStats(
    userId: string,
    collectionId: string,
    delta: CollectionStatsDelta,
  ): Promise<KnowledgeCollection | null>;
  deleteCollection(userId: string, collectionId: string): Promise<boolean>;
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
