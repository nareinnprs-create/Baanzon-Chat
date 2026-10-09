import { randomUUID } from 'crypto';
import { logger } from '@librechat/data-schemas';
import type {
  KnowledgeCollection,
  KnowledgeCollectionListing,
  CollectionPatch,
  CollectionScope,
  VectorChunk,
  CreateCollectionParams,
  AddDocumentParams,
  RetrieveParams,
  RetrievedSnippet,
  RetrievalSource,
} from './types';
import type { ChunkEmbedder, EmbeddingReport } from './embeddings';
import type { VectorStore, KnowledgeStore } from './types';
import type { RagActor } from './authorization';
import { canWriteCollection, canUseScope } from './authorization';
import { badRequest, forbidden, notFound } from './errors';
import { embedChunks, EMBED_REMEDY } from './embeddings';
import { RAG_DEFAULTS } from './config';
import { chunkText } from './chunker';

export interface RagServiceDeps {
  config: {
    chunkSize: number;
    chunkOverlap: number;
    hybridAlpha: number;
    candidateK: number;
    topK: number;
    minScore: number;
    /**
     * Bounds on the ingest-side embedder. Optional because a service wired
     * directly — the same hand-wired path `configuredGeometry` below defends —
     * predates them, and each falls back to `RAG_DEFAULTS`, which reproduces the
     * behaviour of having no embedder at all.
     */
    embeddingTimeoutMs?: number;
    embeddingBatchSize?: number;
    embeddingConcurrency?: number;
  };
  knowledgeStore: KnowledgeStore;
  /**
   * How many collections the caller can see, uncapped. Supplied by the
   * runtime from the same data-schemas methods the store is built on, and
   * optional because a store that cannot count must not become a second thing
   * this service has to understand: without it the page is reported as the
   * whole list, which is what the response claimed before `total` existed.
   */
  countCollections?: (userId: string) => Promise<number>;
  vectorStore: VectorStore;
  semantic?: {
    search(collectionId: string, query: string, limit: number): Promise<VectorChunk[]>;
  };
  /**
   * Re-orders fully-scored snippets after the hybrid merge. Distinct from the
   * `Reranker` in `./semanticSearch`, which re-orders raw `VectorChunk`
   * candidates before scoring — both are useful, and they are not the same
   * stage, so they do not share a type.
   */
  reranker?: SnippetReranker;
  /**
   * Ingest-side embedder, injected like the read-side `semantic` seam beside it
   * and absent for the same reason. `retrieve` cannot use a vector that ingest
   * never wrote, so this is what makes `semantic` able to return anything at all:
   * supplied, `addDocument` fills `VectorChunk.embedding`; omitted, chunks are
   * written exactly as they were before it existed and retrieval is keyword-only.
   */
  embedder?: ChunkEmbedder;
}

/** Post-merge reranking stage: snippets in, best-first snippets out. */
export interface SnippetReranker {
  rerank(query: string, snippets: RetrievedSnippet[]): Promise<RetrievedSnippet[]>;
}

export interface RagService {
  /**
   * `actor` is the caller's role. It is a required *concept* and an optional
   * *argument*: absent means "not an admin", so a call site that forgets it is
   * refused `global` rather than granted it, and the callers that only need
   * `userId` do not have to supply one.
   */
  createCollection(params: CreateCollectionParams, actor?: RagActor): Promise<KnowledgeCollection>;
  /**
   * One page of the caller's collections, with the count that page is measured
   * against — see {@link KnowledgeCollectionListing}. The page itself is
   * unchanged: same visibility, same newest-first order, same cap, and every
   * collection still carrying the index's own chunk count.
   */
  listCollections(userId: string): Promise<KnowledgeCollectionListing>;
  getCollection(userId: string, collectionId: string): Promise<KnowledgeCollection | null>;
  /**
   * The three write paths below answer their refusals the same way, and it is
   * worth knowing which way before calling one: a collection that is missing, or
   * is another user's `private` one, comes back as `null`/`false` (404), while a
   * `global` collection the caller may read but not write throws a 403
   * `RagError`. Only the second one throws for a *visible* collection, which is
   * the whole difference between the two answers — see `writableCollection` in
   * the implementation for why it is not folded into the first.
   */
  updateCollection(
    userId: string,
    collectionId: string,
    patch: CollectionPatch,
    actor?: RagActor,
  ): Promise<KnowledgeCollection | null>;
  deleteCollection(userId: string, collectionId: string): Promise<boolean>;
  addDocument(params: AddDocumentParams): Promise<AddDocumentResult>;
  deleteDocument(userId: string, collectionId: string, documentId: string): Promise<boolean>;
  /** `null` when the collection is missing or the caller may not read it. */
  retrieve(params: RetrieveParams): Promise<RetrievedSnippet[] | null>;
}

/**
 * What one ingest reports.
 *
 * Both of its caveats are the same kind of fact — the write landed, and here is
 * the part of it you cannot rely on — and both are in the response rather than
 * only in a log line, for the same reason: the response is the only place a
 * client can act on them. Neither is ever a failure. Re-ingesting because of one
 * would duplicate content, and reading the index as whole because of one would
 * misreport a collection that is in fact served.
 *
 * `ledgerStale` is present — and only present — when the store refused the
 * counter bump that should have followed the write, which is the one way this
 * collection's `documentCount` can come to disagree with its contents.
 *
 * `embedding` is present — and only present — when some of the written chunks
 * came back without a usable vector, so absence means every chunk is embedded
 * and cannot itself be read as a report of failure. The write is never refused
 * for it: an embedder that is unset, slow or broken leaves the chunks stored and
 * findable by keyword, and the gap is stated rather than hidden.
 */
export interface AddDocumentResult {
  documentId: string;
  chunkCount: number;
  /** The collection's own counters do not describe this document. */
  ledgerStale?: boolean;
  /** Some of the stored chunks carry no vector, and this is why. */
  embedding?: EmbeddingReport;
}

const nowIso = (): string => new Date().toISOString();

/**
 * The denial, naming the reason. `Collection scope not permitted: global` alone
 * leaves a caller choosing between retrying, asking an admin and giving up;
 * the reason is the difference between a message they can act on and one they
 * have to escalate. The `global` case is the only conditional one, so it is the
 * only one whose reason can differ from the scope it names.
 */
function scopeDenied(scope: CollectionScope) {
  return scope === 'global'
    ? forbidden('Collection scope not permitted: global requires the ADMIN role')
    : forbidden(`Collection scope not permitted: ${String(scope)}`);
}

/**
 * The refusal for a collection the caller can see and still may not write.
 *
 * 403 rather than 404, and the reason is the visibility rule rather than
 * politeness: `getCollection` already returned this collection to the caller,
 * so "not found" is a statement the caller can disprove with the 200 it just
 * got, and the shipped client acts on it — `resolveDelete` in
 * `client/src/data-provider/Knowledge/mutations.ts` turns any 404 from a delete
 * into `{ deleted: true }` and runs the whole success path, so a non-owner
 * deleting a shared collection would be told it was gone, have it dropped from
 * their list, and find it still served to everyone at 200. Answering 403 leaves
 * the collection where it is and reports the thing the caller can act on.
 *
 * One message for all four write paths, so a client matches on the status and
 * never on the text — the HTTP layer classifies by `RagError.status`, so this
 * string is a label and not a contract.
 */
function writeDenied() {
  return forbidden('Access denied');
}

/** Code points, not UTF-16 code units, so the cap does not halve for non-BMP text. */
function assertValidCollectionName(name: string): void {
  const length = [...name.trim()].length;
  if (length === 0 || length > 64) {
    throw badRequest('Collection name must be 1..64 characters');
  }
}

/**
 * The size a caller asked for, against the same bounds the route applies.
 *
 * `validation.ts` holds these numbers and its own copies of them; they are
 * repeated here for the reason {@link assertValidCollectionName} is repeated —
 * a direct `createRagService(...).createCollection(...)` call is not a request,
 * and the route is only one of the ways in.
 */
const CHUNK_SIZE_MIN = 16;
const CHUNK_SIZE_MAX = 8_000;

/**
 * Chunk geometry, checked here as well as in `validation.ts` for the same
 * defence-in-depth reason as the name above, and because the failure is
 * unusually deferred: the geometry is persisted with the collection and read by
 * every later ingest of it, so a value that survives this check can never
 * detonate on a subsequent `addDocument`. A `chunkSize` of 0 is stored happily
 * by a caller that skipped the route — `required` rejects only `undefined` — and
 * then fails every `POST /:id/documents` for that collection for good.
 *
 * The messages are the validator's verbatim, so a caller cannot tell which of
 * the two refused it, and `service.spec.ts` pins the two against each other
 * rather than trusting them to stay alike.
 */
function assertChunkSize(chunkSize: number): void {
  if (!Number.isInteger(chunkSize)) {
    throw badRequest('chunkSize must be an integer');
  }
  if (chunkSize < CHUNK_SIZE_MIN || chunkSize > CHUNK_SIZE_MAX) {
    throw badRequest(`chunkSize must be between ${CHUNK_SIZE_MIN} and ${CHUNK_SIZE_MAX}`);
  }
}

/**
 * The overlap, against the size the collection is *stored* with — which is the
 * size it has to fit inside, whether that size came from this request or from
 * the deployment's config. `validation.ts` makes the same comparison against the
 * resolved config when the body omits the size, because comparing against a size
 * the body happened to carry let an overlap of 1,000,000 through against a
 * configured 200.
 */
function assertChunkOverlap(chunkOverlap: number, chunkSize: number): void {
  if (!Number.isInteger(chunkOverlap)) {
    throw badRequest('chunkOverlap must be an integer');
  }
  if (chunkOverlap < 0) {
    throw badRequest('chunkOverlap must be >= 0');
  }
  if (chunkOverlap >= chunkSize) {
    throw badRequest('chunkOverlap must be less than chunkSize');
  }
}

function keywordScore(text: string, query: string): number {
  const q = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (q.length === 0) {
    return 0;
  }
  const t = text.toLowerCase();
  let hits = 0;
  for (const tok of q) {
    if (t.includes(tok)) {
      hits += 1;
    }
  }
  return hits / q.length;
}

export function createRagService(deps: RagServiceDeps): RagService {
  /**
   * The deployment's own chunk geometry, checked once per service.
   *
   * Only what would make a collection *unable to ingest* is corrected here, and
   * only because it has to be: `chunkText` throws on a size that is not
   * positive, and a `NaN` overlap makes the resume arithmetic meaningless. Both
   * are things `ragSchema` already refuses — it takes a positive integer size and
   * a non-negative integer overlap — so neither can arrive from `baanzon.yaml`.
   * This is the seam a *hand-wired* `createRagService` config goes through, and
   * the fallback is what keeps such a caller from minting collections that can
   * never ingest: the same guarantee the request-side checks give, from the one
   * direction that has no request to check.
   *
   * A configured *pair* that is incoherent — an overlap at or above the size — is
   * resolved rather than refused, and this is the trade. Such a collection
   * ingests either way, because `chunkText` already caps any overlap at
   * `floor(chunkSize / 2)`, so the only real choice is which number the
   * collection records. It records the one that will be applied, which is what
   * makes a stored overlap the effective overlap: nothing later reads
   * `chunkOverlap` to decide anything, `addDocument` hands it straight to
   * `chunkText`, and a collection that stored 100,000 would report a geometry
   * its own index never used — the "stored differs from effective" failure
   * `validation.ts` refuses to create for a request and which the deployment's
   * own block would otherwise walk straight into. Refusing the pair instead would
   * turn the operator's `rag:` block into a 400 on every create, so a deployment
   * that is working today stops working for a value nothing is harmed by, and no
   * request can be blamed for the pair. The place that should reject it is
   * `ragSchema` itself — a cross-field refinement in `packages/data-provider`,
   * which `validation.spec.ts` already records as that gap's owner — and until
   * then the mismatch is reported once, naming both numbers, rather than left to
   * be discovered as a surprising chunk count.
   */
  const configuredGeometry = (() => {
    const { chunkSize: configuredSize, chunkOverlap: configuredOverlap } = deps.config;
    const chunkSize =
      Number.isInteger(configuredSize) && configuredSize > 0
        ? configuredSize
        : RAG_DEFAULTS.chunkSize;
    const chunkOverlap =
      Number.isInteger(configuredOverlap) && configuredOverlap >= 0 ? configuredOverlap : 0;
    if (chunkSize !== configuredSize || chunkOverlap !== configuredOverlap) {
      logger.error(
        `[rag] configured chunk geometry cannot chunk and was replaced before any collection ` +
          `stored it: chunkSize ${String(configuredSize)} -> ${chunkSize}, chunkOverlap ` +
          `${String(configuredOverlap)} -> ${chunkOverlap}`,
      );
    }
    /** `chunker.ts` caps the overlap here, so this is the number ingest uses. */
    const effectiveOverlap = Math.min(chunkOverlap, Math.floor(chunkSize / 2));
    if (effectiveOverlap !== chunkOverlap) {
      logger.error(
        `[rag] configured chunkOverlap ${chunkOverlap} is not below chunkSize ${chunkSize}, so ` +
          `collections store the ${effectiveOverlap} the chunker will apply; the pair belongs in ` +
          `one \`rag:\` block that agrees with itself`,
      );
    }
    return { chunkSize, chunkOverlap: effectiveOverlap };
  })();

  /**
   * The chunk count a caller is shown is the index's, not the ledger's. A
   * process-scoped vector store loses its chunks on restart while the durable
   * collection metadata keeps them, so the ledger alone would report an empty
   * collection as full. The ledger keeps its job as the durable bookkeeping —
   * writes still go through `bumpCollectionStats`, and `documentCount` has no
   * store-side counterpart to check — but it is not what this service reports,
   * because a count nobody can verify is worse than a smaller true one.
   */
  const withStoredChunkCount = async (
    collection: KnowledgeCollection,
  ): Promise<KnowledgeCollection> => ({
    ...collection,
    chunkCount: await deps.vectorStore.countChunks(collection.id),
  });

  /**
   * Compares the ledger against the index after a write. The gap is what a
   * restart leaves behind, and it is otherwise invisible: `getCollection`
   * papers over it with the stored count, so without this the drift would be
   * reported and then forgotten. One benign cause is a concurrent ingest whose
   * vectors are already stored but whose `$inc` has not landed yet, so this
   * warns rather than throws — a gap that survives the next write is a real one.
   */
  const warnOnChunkDrift = async (
    collectionId: string,
    ledger: KnowledgeCollection,
    cause: string,
  ): Promise<void> => {
    const stored = await deps.vectorStore.countChunks(collectionId);
    if (stored !== ledger.chunkCount) {
      logger.warn(
        `[rag] chunk-count drift on ${collectionId} after ${cause}: the index holds ` +
          `${stored} chunk(s) while the ledger says ${ledger.chunkCount}`,
      );
    }
  };

  /**
   * Fills `VectorChunk.embedding` for one document's chunks, or says why not.
   *
   * No embedder is the shipped state and the reason this is off by default:
   * nothing runs, the chunks are byte-identical to what ingest wrote before this
   * existed, and retrieval stays keyword-only. That is the whole default
   * behaviour, and it is why the levers below are inert until a caller supplies
   * one.
   *
   * An embedder that *is* supplied puts a network call on the write path, so it
   * is bounded three ways (`embeddingBatchSize`, `embeddingConcurrency`,
   * `embeddingTimeoutMs`) and every way it can fail degrades to the state the
   * domain was in before this method: the chunks are stored, `keywordScore` still
   * finds them, and the gap is named in the response *and* the log. Refusing the
   * write instead would turn one provider's outage into a refusal to ingest
   * content the caller can already search.
   *
   * The report is absent whenever every chunk got a vector, so its absence is
   * not a report of failure — the same reading `ledgerStale` has.
   */
  const applyEmbeddings = async (
    collectionId: string,
    documentId: string,
    chunks: VectorChunk[],
  ): Promise<EmbeddingReport | undefined> => {
    if (deps.embedder == null) {
      return undefined;
    }
    const result = await embedChunks({
      texts: chunks.map((chunk) => chunk.text),
      embedder: deps.embedder,
      batchSize: deps.config.embeddingBatchSize ?? RAG_DEFAULTS.embeddingBatchSize,
      concurrency: deps.config.embeddingConcurrency ?? RAG_DEFAULTS.embeddingConcurrency,
      timeoutMs: deps.config.embeddingTimeoutMs ?? RAG_DEFAULTS.embeddingTimeoutMs,
    });
    for (const [index, vector] of result.vectors.entries()) {
      if (vector != null) {
        chunks[index].embedding = vector;
      }
    }
    if (result.degraded == null) {
      return undefined;
    }
    logger.warn(
      `[rag] document ${documentId} in ${collectionId} stored ${chunks.length} chunk(s) with ` +
        `${result.embedded} embedding(s) (${result.degraded}): ${EMBED_REMEDY[result.degraded]}. ` +
        `The chunks are stored and retrievable by keyword, but the semantic half cannot score them, ` +
        `so re-ingest this document once the embedder is healthy`,
    );
    return { embedded: result.embedded, total: chunks.length, degraded: result.degraded };
  };

  /**
   * The collection a write is about, or `null` when the caller cannot see it.
   *
   * The single seam all four write paths resolve their target through, so they
   * cannot answer the same condition differently again. It splits the three
   * cases in two: a collection that is missing, or is another user's `private`
   * one, is `null` — 404, the same answer whether it is absent or hidden — while
   * a `global` collection the caller may read but not write throws
   * {@link writeDenied}. Both are refusals, so no request is served by either;
   * they differ in what the caller is told, and only one of the two can be
   * called "not found" without lying.
   */
  const writableCollection = async (
    userId: string,
    collectionId: string,
  ): Promise<KnowledgeCollection | null> => {
    const collection = await service.getCollection(userId, collectionId);
    if (collection == null) {
      return null;
    }
    if (!canWriteCollection(userId, collection)) {
      throw writeDenied();
    }
    return collection;
  };

  const service: RagService = {
    async createCollection(
      params: CreateCollectionParams,
      actor?: RagActor,
    ): Promise<KnowledgeCollection> {
      assertValidCollectionName(params.name);
      /**
       * The geometry this collection is about to be *stored* with, and so the
       * geometry every later ingest of it runs. Only a value the request carried
       * is refused — a 400, with the route's own message, before the id is minted
       * and before the store is touched. The configured half is settled in
       * `configuredGeometry` above, because nobody at this request can correct it.
       */
      const chunkSize = params.chunkSize ?? configuredGeometry.chunkSize;
      if (params.chunkSize !== undefined) {
        assertChunkSize(params.chunkSize);
      }
      if (params.chunkOverlap !== undefined) {
        assertChunkOverlap(params.chunkOverlap, chunkSize);
      }
      const scope = params.scope ?? 'private';
      /** Checked before the id is minted and before the store is touched, so a
       *  refused collection leaves no trace to clean up. */
      if (!canUseScope(scope, actor)) {
        throw scopeDenied(scope);
      }
      const id = randomUUID();
      const collection: KnowledgeCollection = {
        id,
        userId: params.userId,
        name: params.name.trim(),
        description: params.description,
        scope,
        chunkSize,
        chunkOverlap: params.chunkOverlap ?? configuredGeometry.chunkOverlap,
        documentCount: 0,
        chunkCount: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await deps.knowledgeStore.createCollection(collection);
      logger.debug(`[rag] created collection ${id} for user ${params.userId}`);
      return collection;
    },

    async listCollections(userId) {
      /**
       * Three independent reads, overlapped rather than awaited in sequence: the
       * page, the store's own capacity (a synchronous in-process answer) and
       * the uncapped count. The count is the only one that leaves the process,
       * and it exists solely to answer "is this the whole list", so it must not
       * add a round trip after the page has already arrived.
       */
      const [page, capacity, total] = await Promise.all([
        deps.knowledgeStore.listCollections(userId),
        Promise.resolve(deps.vectorStore.capacity?.() ?? null),
        /**
         * A store that cannot count degrades to the old meaning — the page
         * *is* the list, `hasMore` is false — rather than to a wrong number. A
         * client that ignores `total` entirely is unaffected either way, which
         * is what keeps this additive.
         */
        deps.countCollections?.(userId),
      ]);
      const collections = await Promise.all(
        page.map((collection) => withStoredChunkCount(collection)),
      );
      const visible = total ?? collections.length;
      return { collections, total: visible, hasMore: visible > collections.length, capacity };
    },

    async getCollection(userId, collectionId) {
      const collection = await deps.knowledgeStore.getCollection(userId, collectionId);
      return collection == null ? null : withStoredChunkCount(collection);
    },

    async updateCollection(userId, collectionId, patch, actor?: RagActor) {
      /** Same rule as `deleteCollection`, and for the same reason: `getCollection`
       *  succeeds for anyone's `global` collection, so renaming or re-scoping one
       *  must be owner-only. Enforced here rather than left to the store's filter
       *  so the rule holds for every `KnowledgeStore` implementation. A non-owner
       *  is refused by `writableCollection` before the store sees anything. */
      const existing = await writableCollection(userId, collectionId);
      if (!existing) {
        return null;
      }
      /** This one gate covers every route to `global`, and the two directions
       *  are deliberately asymmetric. *Into* `global` — promoting a private
       *  collection, which is the same call an owner makes to share one — is
       *  admin-only, and a non-admin owner hits it here. *Out of* `global` is
       *  `private`, which `canUseScope` permits for every role: narrowing is
       *  never a grant, and it has to stay available, or a collection left
       *  `global` by an admin whose role was later reduced could never be
       *  unshared by the one person entitled to fix it. */
      if (patch.scope !== undefined && !canUseScope(patch.scope, actor)) {
        throw scopeDenied(patch.scope);
      }
      if (patch.name !== undefined) {
        assertValidCollectionName(patch.name);
      }
      const updated = await deps.knowledgeStore.updateCollection(userId, collectionId, {
        ...patch,
        updatedAt: nowIso(),
      });
      return updated == null ? null : withStoredChunkCount(updated);
    },

    async deleteCollection(userId, collectionId) {
      /** `getCollection` succeeds for any `global` collection, so ownership must
       *  be checked before the vector store is touched — otherwise any signed-in
       *  user can wipe a shared collection's index and be told "not found". */
      const existing = await writableCollection(userId, collectionId);
      if (!existing) {
        return false;
      }
      const deleted = await deps.knowledgeStore.deleteCollection(userId, collectionId);
      if (!deleted) {
        return false;
      }
      await deps.vectorStore.deleteCollection(collectionId);
      return true;
    },

    async addDocument(params) {
      /**
       * RFC 9110 §15.5.4 for the missing case, §15.5.4's sibling §15.5.2 for
       * the other one, and all three value-returning siblings agree because they
       * resolve their target through `writableCollection` rather than
       * re-deciding: a collection that is missing, or another user's `private`
       * one, is 404 — the same answer whether it is absent or hidden — and a
       * `global` collection the caller may read but not write is 403.
       *
       * A 403 here discloses nothing the caller cannot already see: `global` is
       * world-readable, so this caller has just been handed the collection at 200
       * by `GET /:id` and cannot tell 403 from 404 that they are in a position to
       * act on. Answering 404 would, and the shipped client acts on it —
       * `resolveDelete` turns any 404 from a delete into `{ deleted: true }` and
       * runs the success path, so a non-owner would be told the collection was
       * gone and watch it drop out of their list while it keeps serving everyone.
       */
      const collection = await writableCollection(params.userId, params.collectionId);
      if (!collection) {
        throw notFound('Collection not found');
      }
      const chunks = chunkText(params.content, collection.chunkSize, collection.chunkOverlap);
      if (chunks.length === 0) {
        throw badRequest('Document contains no extractable text');
      }
      const documentId = randomUUID();
      const vectorChunks: VectorChunk[] = chunks.map((c) => ({
        collectionId: params.collectionId,
        documentId,
        chunkIndex: c.index,
        text: c.text,
        metadata: {
          ...(params.metadata ?? {}),
          source: params.source,
        },
      }));
      /** Before the store sees them: a chunk the embedder could not vector is
       *  still a chunk, and storing it unvectored is what keeps the document
       *  findable by keyword. */
      const embedding = await applyEmbeddings(params.collectionId, documentId, vectorChunks);
      await deps.vectorStore.upsertChunks(params.collectionId, vectorChunks);
      /** Deltas, not values read above: the vector upsert awaited, so another
       *  ingest for this collection may have committed in between and an
       *  absolute `$set` would drop its increments. */
      const bumped = await deps.knowledgeStore.bumpCollectionStats(
        params.userId,
        params.collectionId,
        {
          documentDelta: 1,
          chunkDelta: vectorChunks.length,
        },
      );
      if (bumped == null) {
        /** The store's owner filter refused the bump, so the vectors just
         *  written are orphaned over a ledger that did not move. */
        logger.warn(
          `[rag] stored ${vectorChunks.length} chunk(s) for document ${documentId} in ` +
            `${params.collectionId} but its counters did not move; the index and the ledger now disagree`,
        );
      } else {
        await warnOnChunkDrift(params.collectionId, bumped, `ingesting document ${documentId}`);
      }
      logger.debug(
        `[rag] added document ${documentId} (${vectorChunks.length} chunks) to ${params.collectionId}`,
      );
      /**
       * The one case where this response has to carry a caveat. `chunkCount`
       * beside it is the store's own and is always true; the collection's
       * `documentCount` is a durable ledger value with no store-side counterpart
       * to be re-derived from, so a refused bump is the only way it can end up
       * describing a collection this document is not in. The write landed, so
       * the caller is not told it failed — it is told the count to distrust.
       */
      return {
        documentId,
        chunkCount: vectorChunks.length,
        ...(bumped == null ? { ledgerStale: true } : {}),
        ...(embedding != null ? { embedding } : {}),
      };
    },

    async deleteDocument(userId, collectionId, documentId) {
      const collection = await writableCollection(userId, collectionId);
      if (!collection) {
        return false;
      }
      /** A document that was never ingested removes nothing; reporting success
       *  would decrement counters for a document that never existed. */
      const removedChunks = await deps.vectorStore.deleteDocument(collectionId, documentId);
      if (removedChunks === 0) {
        return false;
      }
      const bumped = await deps.knowledgeStore.bumpCollectionStats(userId, collectionId, {
        documentDelta: -1,
        chunkDelta: -removedChunks,
      });
      if (bumped == null) {
        logger.warn(
          `[rag] removed ${removedChunks} chunk(s) for document ${documentId} in ${collectionId} ` +
            `but its counters did not move; the index and the ledger now disagree`,
        );
      } else {
        await warnOnChunkDrift(collectionId, bumped, `deleting a document`);
      }
      return true;
    },

    async retrieve(params): Promise<RetrievedSnippet[] | null> {
      const collection = await service.getCollection(params.userId, params.collectionId);
      if (!collection) {
        return null;
      }
      const semantic = deps.semantic
        ? await deps.semantic.search(params.collectionId, params.query, deps.config.candidateK)
        : [];
      const keyword = deps.vectorStore.semanticSearch
        ? await deps.vectorStore.semanticSearch(
            params.collectionId,
            params.query,
            deps.config.candidateK,
          )
        : [];
      /** `alpha` is the weight on the semantic side, and it is fixed by the
       *  *client*, not by whether the client found anything this query. Scaling
       *  it by the result count would give the same `minScore` two meanings
       *  across one session; fixed as it is, one chunk's score depends on that
       *  chunk's own evidence and this number, and on nothing else about the
       *  query. */
      const requestedAlpha = params.hybridAlpha ?? deps.config.hybridAlpha;
      const alpha = Math.max(0, Math.min(1, requestedAlpha));
      const topK = params.topK ?? deps.config.topK;

      const byChunk = new Map<string, { chunk: VectorChunk; sem: number; kw: number }>();
      const key = (chunk: VectorChunk): string => `${chunk.documentId}:${chunk.chunkIndex}`;
      for (const chunk of semantic) {
        const entry = byChunk.get(key(chunk)) ?? { chunk, sem: 0, kw: 0 };
        entry.sem = Math.max(entry.sem, 1);
        byChunk.set(key(chunk), entry);
      }
      for (const chunk of keyword) {
        const existing = byChunk.get(key(chunk));
        const entry = existing ?? { chunk, sem: 0, kw: 0 };
        entry.kw = Math.max(entry.kw, keywordScore(chunk.text, params.query));
        if (!existing) {
          byChunk.set(key(chunk), entry);
        }
      }

      const minScore = deps.config.minScore;
      const snippets: RetrievedSnippet[] = [];
      for (const { chunk, sem, kw } of byChunk.values()) {
        /**
         * Per candidate, not per query: the blend weighs the two halves for a chunk
         * both halves returned, and a chunk the semantic half did *not* return is
         * scored by the keyword evidence it actually has.
         *
         * The alternative — deciding once per query whether "blending happened",
         * from whether a client was injected — has to charge every keyword score
         * `(1 - alpha)` for a semantic half that returned nothing, and the factor is
         * not small: at the shipped `alpha: 0.5` it halves every score, so a chunk
         * whose keyword score sits on `minScore` drops out of a result set keyword
         * search alone returned, and the higher the operator's alpha the more of the
         * result set a silent semantic half empties. Nothing observes that today,
         * because no shipped wiring injects a semantic client — which is why it has
         * to be settled here rather than by the first person who wires one.
         *
         * Silence from the semantic half is not evidence of irrelevance either, and
         * it is *permanently* silent about any chunk that carries no vector: a
         * document whose ingest embedder failed can never be returned by a semantic
         * client, so scaling those scores down prices a provider outage into the
         * caller's results. Scaling on the *present* signals instead is what keeps
         * one floor meaning one thing, and it is what makes `hybridAlpha: 1` fall
         * back to keyword ranking for a chunk the semantic half cannot speak about
         * rather than dropping it.
         */
        const score = sem > 0 ? alpha * sem + (1 - alpha) * kw : kw;
        if (score < minScore) {
          continue;
        }
        let source: RetrievalSource = 'keyword';
        if (sem > 0) {
          source = kw > 0 ? 'hybrid' : 'semantic';
        }
        snippets.push({
          collectionId: params.collectionId,
          documentId: chunk.documentId,
          text: chunk.text,
          score,
          source,
          chunkIndex: chunk.chunkIndex,
          metadata: chunk.metadata,
        });
      }

      snippets.sort((a, b) => b.score - a.score);
      return deps.reranker
        ? (await deps.reranker.rerank(params.query, snippets)).slice(0, topK)
        : snippets.slice(0, topK);
    },
  };

  return service;
}
