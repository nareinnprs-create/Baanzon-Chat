/**
 * Boot-time integration wiring for the RAG domain.
 *
 * Semantic retrieval needs two injected collaborators — an ingest-side
 * `ChunkEmbedder` and a retrieval-time `EmbeddingsProvider` — and both are
 * integration concerns rather than per-request config: the route factory takes
 * them at construction, so they are built exactly once. Their endpoint,
 * credential and model therefore come from the environment, mirroring
 * `RAG_API_URL`, the domain's one existing boot-time integration endpoint. This
 * module keeps that resolution in the package so `/api` stays wiring-only — the
 * knowledge route just hands the result to `createRagRoutes`.
 *
 * When `RAG_EMBEDDING_API_URL` is unset nothing is returned and the domain runs
 * keyword-only, which is the guaranteed fallback in every deployment that has
 * not configured a provider.
 *
 * The vector backend (`rag.vectorStore`) is the third startup decision, and it
 * is injected rather than constructed: `initializeRagVectorStore` turns the
 * caller's `PgQueryExecutor` plus config into a migrated durable store, and
 * `createRagIntegration` refuses to build a pg-mode integration without one.
 * Neither ever falls back across modes — serving the in-memory index to a
 * deployment that asked for durability would drop every vector on restart while
 * the durable ledger still counted them.
 */
import { createPgVectorMigration, runPgMigrations } from '@librechat/data-schemas';
import type { VectorChunk, VectorStore } from './types';
import type { PgQueryExecutor } from './pgVectorStore';
import type { ChunkEmbedder } from './embeddings';
import type { RagDomainConfig } from './config';
import {
  createPgVectorStore,
  createSchemaSql,
  DEFAULT_PG_VECTOR_TABLE,
  DEFAULT_PG_VECTOR_DIMENSIONS,
} from './pgVectorStore';
import { createSemanticSearchService } from './semanticSearch';
import { createOpenAIEmbeddings } from './openaiEmbeddings';
import { InMemoryVectorStore } from './vectorStores';
import { RAG_DEFAULTS } from './config';

/** OpenAI-compatible embeddings endpoint root, e.g. `https://api.openai.com/v1`. */
export const RAG_EMBEDDING_API_URL = 'RAG_EMBEDDING_API_URL';
/** Bearer token for that endpoint. Optional: local providers (Ollama/vLLM) need none. */
export const RAG_EMBEDDING_API_KEY = 'RAG_EMBEDDING_API_KEY';
/** Provider model id. */
export const RAG_EMBEDDING_MODEL = 'RAG_EMBEDDING_MODEL';
/** Fixed vector length the provider returns. */
export const RAG_EMBEDDING_DIMENSION = 'RAG_EMBEDDING_DIMENSION';

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
export const DEFAULT_EMBEDDING_DIMENSION = 1536;

/** The subset of `RagRuntimeDeps` the integration supplies. */
export interface RagIntegration {
  /** Ingest-side embedder, or absent for keyword-only ingestion. */
  embedder?: ChunkEmbedder;
  /** Retrieval-side semantic client, or absent for keyword-only retrieval. */
  semantic?: { search(collectionId: string, query: string, limit: number): Promise<VectorChunk[]> };
}

export interface RagIntegrationOptions {
  /** Process-scoped index the semantic client scores against. */
  vectorStore: VectorStore;
  /**
   * The durable store, required when `config.vectorStore` is `'pg'` and
   * ignored otherwise. Built by {@link initializeRagVectorStore}, which runs
   * the pgvector migration first; without it pg mode throws instead of
   * silently scoring against `vectorStore`.
   */
  pgVectorStore?: VectorStore;
  /** Retrieval tuning plus the store selector; defaults to `RAG_DEFAULTS`. */
  config?: Pick<RagDomainConfig, 'candidateK' | 'topK' | 'minScore' | 'vectorStore'>;
  /** Environment to read; defaults to `process.env`. Injected for tests. */
  env?: NodeJS.ProcessEnv;
}

/** A configured dimension, or the fallback when it is missing or not positive. */
function positiveDimension(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Build the semantic collaborators from the environment, or nothing.
 *
 * Both returned members come from the same provider, so supplying one without
 * the other — an embedder with no reader, or a reader over vectors no ingest
 * ever wrote — is not a state this can produce.
 *
 * The mode guard runs before the environment is read: pg mode missing its
 * injected store is a deployment error and must fail the build even when no
 * embeddings endpoint is configured, or the domain would quietly come up
 * keyword-only over the wrong store.
 */
export function createRagIntegration(options: RagIntegrationOptions): RagIntegration {
  const mode = options.config?.vectorStore ?? RAG_DEFAULTS.vectorStore;
  let store = options.vectorStore;
  if (mode === 'pg') {
    if (options.pgVectorStore == null) {
      throw new Error(
        `rag.vectorStore is 'pg' but no pgVectorStore was injected: build one with ` +
          `initializeRagVectorStore({ config, pgQuery }) and pass it as pgVectorStore. ` +
          `pg mode has no in-memory fallback.`,
      );
    }
    store = options.pgVectorStore;
  }

  const env = options.env ?? process.env;
  const baseURL = (env[RAG_EMBEDDING_API_URL] ?? '').trim();
  if (baseURL.length === 0) {
    return {};
  }
  const { chunkEmbedder, queryEmbedder } = createOpenAIEmbeddings({
    baseURL,
    apiKey: env[RAG_EMBEDDING_API_KEY] ?? '',
    model: (env[RAG_EMBEDDING_MODEL] ?? '').trim() || DEFAULT_EMBEDDING_MODEL,
    dimension: positiveDimension(env[RAG_EMBEDDING_DIMENSION], DEFAULT_EMBEDDING_DIMENSION),
  });
  const semantic = createSemanticSearchService({
    config: options.config ?? RAG_DEFAULTS,
    vectorStore: store,
    embeddings: queryEmbedder,
  });
  return { embedder: chunkEmbedder, semantic };
}

export interface InitializeRagVectorStoreOptions {
  /**
   * Resolved config: the store selector plus the in-memory ceilings. The mode
   * is required rather than optional so a caller holding `req.config.rag` —
   * whose `vectorStore` is absent when the `rag:` block omits it — has to
   * resolve it against `RAG_DEFAULTS.vectorStore` at the call site instead of
   * receiving a silent in-memory store.
   */
  config: Pick<RagDomainConfig, 'vectorStore' | 'inMemoryMaxCollections' | 'inMemoryMaxChunks'>;
  /** Injected database client; required when `config.vectorStore` is `'pg'`. */
  pgQuery?: PgQueryExecutor;
  /** Vectors table; defaults to `DEFAULT_PG_VECTOR_TABLE`. */
  table?: string;
  /** Vector column width; defaults to `DEFAULT_PG_VECTOR_DIMENSIONS`. */
  dimensions?: number;
}

/**
 * Build the process's vector store from config, once, at startup.
 *
 * `inMemory` (the default) constructs the process-scoped index with its
 * configured ceilings and touches nothing else — no query, no migration, no
 * side effect, whatever `pgQuery` was handed. `pg` requires the caller's
 * {@link PgQueryExecutor}, applies the pgvector schema migration through
 * `runPgMigrations` (so the ledger records it once and a racing second boot
 * skips it), and returns the durable store over the same executor.
 *
 * There is no fallback between the modes: pg mode without an executor throws,
 * because the alternative — quietly serving the in-memory index — loses every
 * vector on restart while the collection ledger still counts them.
 */
export async function initializeRagVectorStore(
  options: InitializeRagVectorStoreOptions,
): Promise<VectorStore> {
  const { config } = options;

  if (config.vectorStore !== 'pg') {
    return new InMemoryVectorStore({
      maxCollections: config.inMemoryMaxCollections,
      maxChunks: config.inMemoryMaxChunks,
    });
  }

  if (options.pgQuery == null) {
    throw new Error(
      `rag.vectorStore is 'pg' but no pgQuery executor was injected: pass the ` +
        `deployment's PgQueryExecutor (its pg Pool) to initializeRagVectorStore. ` +
        `pg mode has no in-memory fallback.`,
    );
  }

  const table = options.table ?? DEFAULT_PG_VECTOR_TABLE;
  const dimensions = options.dimensions ?? DEFAULT_PG_VECTOR_DIMENSIONS;
  await runPgMigrations({
    query: options.pgQuery,
    migrations: [createPgVectorMigration({ createSchemaSql, table, dimensions })],
  });
  return createPgVectorStore({ query: options.pgQuery, table, dimensions });
}
