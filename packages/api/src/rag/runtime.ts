/**
 * RAG / Knowledge — runtime assembly.
 *
 * Turns app config plus injected store methods into ready-to-mount Express
 * handlers. Nothing here reaches for a singleton: the knowledge store and
 * vector store are arguments, so a second vector backend (pgvector, a hosted
 * RAG API) is a new argument rather than a new branch.
 *
 * The vector store is process-scoped, not per-config: it is constructed once by
 * the caller and only its limits are re-applied when config changes. Keying the
 * index on config would give every user a private copy of the vectors.
 */
import type { InMemoryVectorStoreOptions } from './vectorStores';
import type { MongoKnowledgeStoreDeps } from './knowledgeStore';
import type { VectorStore, VectorChunk } from './types';
import type { ChunkEmbedder } from './embeddings';
import type { SnippetReranker } from './service';
import type { RagHandlers } from './handlers';
import { createMongoKnowledgeStore } from './knowledgeStore';
import { RAG_DEFAULTS, RAG_API_URL } from './config';
import { createRagHandlers } from './handlers';
import { createRagService } from './service';

export interface RagRuntimeConfig {
  disabled?: boolean;
  apiUrl?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  hybridAlpha?: number;
  candidateK?: number;
  topK?: number;
  minScore?: number;
  inMemoryMaxCollections?: number;
  inMemoryMaxChunks?: number;
  /** Ingest-side embedder bounds; inert until an `embedder` is supplied. */
  embeddingTimeoutMs?: number;
  embeddingBatchSize?: number;
  embeddingConcurrency?: number;
}

export interface RagRuntimeDeps {
  knowledgeMethods: MongoKnowledgeStoreDeps;
  /**
   * Process-scoped index shared by every request. Required: constructing one
   * per config would partition the vectors per user and turn
   * `inMemoryMaxChunks` into a per-user budget.
   */
  vectorStore: VectorStore & { applyLimits?(options: InMemoryVectorStoreOptions): void };
  /** Supplied when a RAG API is configured; enables the semantic half. */
  semantic?: { search(collectionId: string, query: string, limit: number): Promise<VectorChunk[]> };
  /**
   * Write-side counterpart to `semantic`, and the only thing that can make it
   * return anything: `retrieve` scores candidates against vectors ingest wrote,
   * so a `semantic` client supplied without an `embedder` reads chunks that
   * carry none. Omitted — as in the shipped wiring — `addDocument` writes no
   * embeddings and retrieval is keyword-only.
   */
  embedder?: ChunkEmbedder;
  /**
   * Post-merge reranking, consumed by `RagService.retrieve` once snippets are
   * fully scored. It was on the service's deps and had no route in from here, so
   * a caller had no way to supply it at all; it is the same injection as
   * `semantic` and `embedder`, which is what it now is.
   */
  reranker?: SnippetReranker;
}

export interface RagRuntime {
  /**
   * The domain handlers the Express routes call into.
   *
   * That is the whole surface, and it is deliberately not a capability
   * descriptor: a `usesSemantic` flag used to sit here, computed from
   * `apiUrl` and whether a semantic client was supplied, and nothing outside
   * this package's tests read it — the Express wiring never inspected the
   * runtime, and no semantic client is supplied in the shipped wiring, so it
   * was permanently `false`. Advertising a capability nothing consumes is worse
   * than not having it, and surfacing it on a response would have added a field
   * to the Knowledge API contract that the client's types mirror.
   */
  domainHandlers: RagHandlers;
  disabled: boolean;
}

/** Config precedence: `baanzon.yaml` `rag:` block, then `RAG_API_URL`, then defaults. */
export function resolveRagConfig(config?: RagRuntimeConfig): Required<RagRuntimeConfig> {
  const envUrl = (process.env[RAG_API_URL] ?? '').trim();
  return {
    disabled: config?.disabled ?? RAG_DEFAULTS.disabled,
    apiUrl: config?.apiUrl ?? envUrl,
    chunkSize: config?.chunkSize ?? RAG_DEFAULTS.chunkSize,
    chunkOverlap: config?.chunkOverlap ?? RAG_DEFAULTS.chunkOverlap,
    hybridAlpha: config?.hybridAlpha ?? RAG_DEFAULTS.hybridAlpha,
    candidateK: config?.candidateK ?? RAG_DEFAULTS.candidateK,
    topK: config?.topK ?? RAG_DEFAULTS.topK,
    minScore: config?.minScore ?? RAG_DEFAULTS.minScore,
    inMemoryMaxCollections: config?.inMemoryMaxCollections ?? RAG_DEFAULTS.inMemoryMaxCollections,
    inMemoryMaxChunks: config?.inMemoryMaxChunks ?? RAG_DEFAULTS.inMemoryMaxChunks,
    embeddingTimeoutMs: config?.embeddingTimeoutMs ?? RAG_DEFAULTS.embeddingTimeoutMs,
    embeddingBatchSize: config?.embeddingBatchSize ?? RAG_DEFAULTS.embeddingBatchSize,
    embeddingConcurrency: config?.embeddingConcurrency ?? RAG_DEFAULTS.embeddingConcurrency,
  };
}

/**
 * The count a list page is measured against.
 *
 * `countKnowledgeCollections` ships with the data-schemas methods — the wiring
 * injects the whole set, not a hand-picked subset — but it is not a field of
 * `MongoKnowledgeStoreDeps`, so it is read here through a narrow local type
 * rather than through the adapter that would have to forward it. Extracted
 * unbound-safe (`.bind`) so this stays correct if the methods object is ever
 * handed a class-based implementation.
 *
 * `undefined` on an injected object that predates the method, and the service
 * then reports the page as the whole list — the same thing the response said
 * before `total` existed, so an older store produces an older answer rather
 * than a wrong one.
 */
function countVisibleCollections(
  methods: MongoKnowledgeStoreDeps,
): ((userId: string) => Promise<number>) | undefined {
  const countable = methods as MongoKnowledgeStoreDeps & {
    countKnowledgeCollections?: (userId: string) => Promise<number>;
  };
  const count = countable.countKnowledgeCollections;
  return count == null ? undefined : count.bind(countable);
}

export function createRagRuntime(deps: RagRuntimeDeps, appConfig?: RagRuntimeConfig): RagRuntime {
  const config = resolveRagConfig(appConfig);

  deps.vectorStore.applyLimits?.({
    maxCollections: config.inMemoryMaxCollections,
    maxChunks: config.inMemoryMaxChunks,
  });

  const countCollections = countVisibleCollections(deps.knowledgeMethods);

  const service = createRagService({
    config: {
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
      hybridAlpha: config.hybridAlpha,
      candidateK: config.candidateK,
      topK: config.topK,
      minScore: config.minScore,
      embeddingTimeoutMs: config.embeddingTimeoutMs,
      embeddingBatchSize: config.embeddingBatchSize,
      embeddingConcurrency: config.embeddingConcurrency,
    },
    knowledgeStore: createMongoKnowledgeStore(deps.knowledgeMethods),
    ...(countCollections != null ? { countCollections } : {}),
    vectorStore: deps.vectorStore,
    ...(deps.semantic ? { semantic: deps.semantic } : {}),
    ...(deps.embedder ? { embedder: deps.embedder } : {}),
    ...(deps.reranker ? { reranker: deps.reranker } : {}),
  });

  return {
    domainHandlers: createRagHandlers(service),
    disabled: config.disabled,
  };
}

/**
 * A cache key over a resolved config's *values*.
 *
 * Every field, sorted, tagged with its type and stringified. Sorted so the key
 * does not depend on the order the resolver happens to write its object literal
 * in, and tagged so a value cannot forge a field boundary — a bare
 * `join('|')` would let an `apiUrl` containing `|chunkOverlap=number=12`
 * collide with a different config that set `chunkOverlap: 12`, and a collision
 * there would serve a runtime built with one chunk size to a request carrying
 * another. `String` rather than the raw value because `JSON.stringify` alone
 * renders `NaN`, `Infinity` and `-Infinity` all as `null`, so three different
 * configurations would share a key.
 *
 * `Object.keys` rather than a hand-written list of fields, so a field added to
 * `resolveRagConfig` is in the key from the moment it exists — the failure this
 * guards against is a *missing* field, not a wrong one, and a list written by
 * hand is exactly how that happens.
 */
function runtimeCacheKey(config: Required<RagRuntimeConfig>): string {
  return JSON.stringify(
    Object.keys(config)
      .sort()
      .map((field) => {
        const value = config[field as keyof Required<RagRuntimeConfig>];
        return `${field}=${typeof value}=${String(value)}`;
      }),
  );
}

/**
 * App config arrives per request via `configMiddleware`, and `getAppConfig`
 * deserializes a *fresh* object on every read, so keying on the config object's
 * identity meant the cache could never hit: `createRagRuntime` ran on every
 * Knowledge request, re-resolving the config, re-applying limits to the shared
 * process-scoped store and rebuilding the store/service/handler graph each time.
 *
 * The key is the resolved config's *values* instead, so the documented "built
 * once, cached against the config it was built from" is now what actually
 * happens: every request carrying the same `rag:` block shares one runtime, and
 * a configuration that differs in any field that reaches the runtime gets its
 * own. Two limits that follow from that and are worth stating: the entries are
 * keyed by value in a `Map`, so they are held for the process rather than being
 * collectable with the config object — one entry per distinct configuration,
 * which is a config reload and not a request; and the vector store's limits are
 * re-applied once per distinct configuration instead of once per request, so a
 * request can no longer re-limit the store that another request is mid-write
 * against.
 */
export function createRagRuntimeResolver(
  deps: RagRuntimeDeps,
): (config?: RagRuntimeConfig) => RagRuntime {
  const cache = new Map<string, RagRuntime>();

  return (config) => {
    /** Resolved once, here, and the *resolved* object is what the runtime is
     *  built from, so the key provably describes the runtime behind it.
     *  `resolveRagConfig` is idempotent over its own output — every field is
     *  non-`undefined` and `??` keeps it — so handing it the resolved config
     *  cannot change it, and `RAG_API_URL` cannot re-enter through the gap. */
    const resolved = resolveRagConfig(config);
    const key = runtimeCacheKey(resolved);
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
    const runtime = createRagRuntime(deps, resolved);
    cache.set(key, runtime);
    return runtime;
  };
}
