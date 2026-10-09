import { logger } from '@librechat/data-schemas';

/** Env var for the external RAG API base URL (mirrors `~/files/rag.ts`). */
export const RAG_API_URL = 'RAG_API_URL';

export const RAG_DEFAULTS = {
  /**
   * Last-resort default for the feature kill switch: knowledge retrieval is
   * opt-in, so the default is disabled. `resolveRagConfig` reads this when the
   * resolved config carries no `disabled` of its own.
   */
  disabled: true,
  /** Chunk size in characters (blueprint §20 / §24). */
  chunkSize: 800,
  /** Chunk overlap in characters. */
  chunkOverlap: 80,
  /** Hybrid balance: 0.5 = equal semantic/keyword. */
  hybridAlpha: 0.5,
  /** Candidate chunks gathered before hybrid merge. */
  candidateK: 32,
  /** Final snippet count returned to the caller. */
  topK: 6,
  /** Minimum hybrid score. */
  minScore: 0.1,
  /** In-memory store limits (dev/tests). */
  inMemoryMaxCollections: 200,
  inMemoryMaxChunks: 20_000,
  /**
   * Milliseconds one embedder call may take on `addDocument` before its batch is
   * abandoned and those chunks are stored without vectors. Without a bound, a
   * provider that never answers holds the write open indefinitely.
   */
  embeddingTimeoutMs: 15_000,
  /** Chunk texts per embedder call, so one large ingest is not one call per chunk. */
  embeddingBatchSize: 64,
  /** Embedder calls in flight at once. */
  embeddingConcurrency: 2,
} as const;

export interface RagDomainConfig {
  /** Feature kill switch. Defaults to `RAG_DEFAULTS.disabled` (disabled). */
  disabled: boolean;
  /** External RAG API base URL (empty = keyword-only retrieval). */
  apiUrl: string;
  chunkSize: number;
  chunkOverlap: number;
  hybridAlpha: number;
  candidateK: number;
  topK: number;
  minScore: number;
  inMemoryMaxCollections: number;
  inMemoryMaxChunks: number;
  /**
   * Ingest-side embedding limits. They govern nothing until an embedder is
   * actually injected — the shipped wiring has none, and the document above says
   * so — and they exist so that the write path is bounded on the day one is.
   */
  embeddingTimeoutMs: number;
  embeddingBatchSize: number;
  embeddingConcurrency: number;
}

/** Loads RAG config from defaults merged with `RAG_API_URL` env — same source `~/files/rag.ts` uses. */
export function loadRagConfig(): RagDomainConfig {
  return { ...RAG_DEFAULTS, apiUrl: (process.env[RAG_API_URL] ?? '').trim() };
}

/** True when an external RAG API is configured (semantic retrieval available). */
export function isRagApiConfigured(config: Pick<RagDomainConfig, 'apiUrl'>): boolean {
  return config.apiUrl.trim().length > 0;
}

/** Uses the external RAG API for retrieval (vs. keyword-only fallback). */
export function usesRagApi(config: Pick<RagDomainConfig, 'apiUrl'>): boolean {
  if (!isRagApiConfigured(config)) {
    logger.debug('[rag:config] RAG_API_URL not set; knowledge retrieval is keyword-only');
    return false;
  }
  return true;
}
