import { ragSchema } from 'librechat-data-provider';

import type { TCustomConfig, TRagConfig } from 'librechat-data-provider';

import logger from '~/config/winston';

/** Env var for the external RAG API base URL (mirrors `~/files/rag.ts`). */
export const RAG_API_URL = 'RAG_API_URL';

export const RAG_DEFAULTS = {
  /** Knowledge retrieval is on by default; the kill switch is `disabled: true`. */
  disabled: false,
  chunkSize: 800,
  chunkOverlap: 80,
  hybridAlpha: 0.5,
  candidateK: 32,
  topK: 6,
  minScore: 0.1,
  /** Enable the semantic half once an embeddings provider is wired. */
  semanticEnabled: true,
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
 * block resolves to the defaults, which leave retrieval on with the semantic
 * half enabled and the keyword path as the guaranteed fallback.
 *
 * Every parsed field is spread through rather than the two that used to be
 * forwarded: dropping `chunkSize` and the rest here meant a `rag:` block could
 * set them and `req.config.rag` would still hand the route the defaults, so the
 * validator and the service disagreed with the operator's own config.
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
    ...source,
    disabled: source.disabled ?? RAG_DEFAULTS.disabled,
    apiUrl: apiUrlConfigured ? (source.apiUrl ?? '') : envUrl,
  };
}
