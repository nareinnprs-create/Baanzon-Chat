import type { TRagConfig } from '../config';

/**
 * Who can see and retrieve from a knowledge collection: its single owner, or
 * the whole deployment.
 *
 * `project` was in this union and never was a scope the server honoured —
 * visibility is owner-or-`global`, so a collection created with it came back
 * exactly like a `private` one. The server refuses the value, and the union is
 * narrowed to match so a client cannot compile a request that can only fail at
 * runtime, and so the value the client sends is the value the service stores.
 *
 * A collection stored with the retired value before that refusal still reads
 * back as an owner-only collection; the union describes what a client may
 * *send*, not what an old row can still contain.
 */
export type TKnowledgeCollectionScope = 'private' | 'global';

/** A named corpus of ingested documents, stored pre-chunked. */
export type TKnowledgeCollection = {
  id: string;
  userId: string;
  name: string;
  description?: string;
  scope: TKnowledgeCollectionScope;
  chunkSize: number;
  chunkOverlap: number;
  documentCount: number;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * What the deployment's vector index can still accept, as the index counts it.
 *
 * `remainingChunks` / `remainingCollections` are `null` where the index sets no
 * ceiling — unbounded is not the same as full, and zero would read as a store
 * that refuses everything. A `capacity` of `null` (or absent) means the store
 * does not report its usage at all, which is a deployment with no such number
 * to give rather than a deployment with none left: render nothing, and let the
 * 409 stand as the only signal in that case.
 */
export type TKnowledgeCapacity = {
  remainingChunks: number | null;
  remainingCollections: number | null;
};

/**
 * `GET /api/knowledge` — the caller's collections.
 *
 * `collections` is the whole contract for every client that predates the count,
 * and it keeps the same key, order and element shape; the three fields beside it
 * are additive, and are optional so a client also runs unchanged against a
 * server that does not send them yet.
 */
export type TKnowledgeCollectionListResponse = {
  collections: TKnowledgeCollection[];
  /**
   * Every collection visible to the caller, not the length of the page. Equal
   * to `collections.length` when the page is uncapped, and larger when it is
   * not — which is the only way a UI can say "showing 200 of 250" instead of
   * implying 200 is all there is.
   */
  total?: number;
  /** `total` exceeds the returned page. The precomputed form of the same fact. */
  hasMore?: boolean;
  capacity?: TKnowledgeCapacity | null;
};

export type TKnowledgeCollectionResponse = {
  collection: TKnowledgeCollection;
};

export type TKnowledgeUpdateResponse = {
  updated: boolean;
  collection: TKnowledgeCollection;
};

export type TKnowledgeDeletedResponse = {
  deleted: boolean;
};

export type TKnowledgeCreateRequest = {
  name: string;
  description?: string;
  scope?: TKnowledgeCollectionScope;
  chunkSize?: number;
  chunkOverlap?: number;
};

/** `id` addresses the collection; every other field is the PATCH body. */
export type TKnowledgeUpdateRequest = {
  id: string;
  name?: string;
  description?: string;
  scope?: TKnowledgeCollectionScope;
};

/** Ingest payload — plain text, chunked server-side. Not a file upload. */
export type TKnowledgeAddDocumentRequest = {
  content: string;
  source?: string;
  metadata?: Record<string, unknown>;
};

/** The only place a `documentId` is handed out; there is no listing route. */
export type TKnowledgeDocumentResponse = {
  documentId: string;
  chunkCount: number;
};

/** Retrieval tuning fields are typed from the server's `rag` config. */
export type TKnowledgeRetrieveRequest = {
  collectionId: string;
  query: string;
  hybridAlpha?: TRagConfig['hybridAlpha'];
  topK?: TRagConfig['topK'];
};

export type TKnowledgeSnippet = {
  collectionId: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  score: number;
  source: 'semantic' | 'keyword' | 'hybrid';
  metadata?: Record<string, unknown>;
};

export type TKnowledgeRetrieveResponse = {
  snippets: TKnowledgeSnippet[];
};
