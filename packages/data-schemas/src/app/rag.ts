import { ragSchema } from 'librechat-data-provider';

import type { TCustomConfig, TRagConfig } from 'librechat-data-provider';

import logger from '~/config/winston';

/** Env var for the external RAG API base URL (mirrors `~/files/rag.ts`). */
export const RAG_API_URL = 'RAG_API_URL';

export const RAG_DEFAULTS = {
  /** Knowledge retrieval is opt-in: the feature is off until a `rag:` block
   *  sets `disabled: false`. */
  disabled: true,
  chunkSize: 800,
  chunkOverlap: 80,
  hybridAlpha: 0.5,
  candidateK: 32,
  topK: 6,
  minScore: 0.1,
  inMemoryMaxCollections: 200,
  inMemoryMaxChunks: 20_000,
  /** Ingest-side embedder bounds, inert until an embedder is injected. */
  embeddingTimeoutMs: 15_000,
  embeddingBatchSize: 64,
  embeddingConcurrency: 2,
} as const;

/**
 * Resolves the retrieval tuning served on `req.config.rag`.
 *
 * Precedence is `baanzon.yaml` `rag:` block, then `RAG_API_URL`, then the
 * defaults above. `RAG_API_URL` is consulted only when the block omits
 * `apiUrl` entirely: writing the key is how a deployment says "keyword-only",
 * so an explicit `apiUrl: ''` must not fall through to the env var. An absent
 * block resolves to the defaults, which disable the feature.
 */
export function loadRagConfig(config?: TCustomConfig['rag']): TRagConfig {
  const envUrl = (process.env[RAG_API_URL] ?? '').trim();
  const parsed = config != null ? ragSchema.safeParse(config) : undefined;

  if (parsed != null && !parsed.success) {
    logger.warn(`[rag] Ignoring invalid \`rag:\` config block: ${parsed.error.message}`);
  }

  const source: Partial<TRagConfig> = parsed?.success ? parsed.data : {};
  const apiUrlConfigured = config != null && Object.prototype.hasOwnProperty.call(config, 'apiUrl');
  return {
    ...RAG_DEFAULTS,
    disabled: source.disabled ?? RAG_DEFAULTS.disabled,
    apiUrl: apiUrlConfigured ? (source.apiUrl ?? '') : envUrl,
  };
}
