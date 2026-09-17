import { logger } from '@librechat/data-schemas';
import { isEnabled } from '~/utils';

/** Env var for the external RAG API base URL (mirrors `~/files/rag.ts`). */
export const RAG_API_URL = 'RAG_API_URL';

export const RAG_DEFAULTS = {
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
} as const;

export interface RagDomainConfig {
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
}

/** Loads RAG config from defaults merged with `RAG_API_URL` env — same source `~/files/rag.ts` uses. */
export function loadRagConfig(): RagDomainConfig {
  const configured = isEnabled(process.env[RAG_API_URL] ?? '') ? process.env[RAG_API_URL]!.trim() : '';
  return { ...RAG_DEFAULTS, apiUrl: configured };
}

/** True when an external RAG API is configured (semantic retrieval available). */
export function isRagApiConfigured(config: Pick<RagDomainConfig, 'apiUrl'>): boolean {
  return isEnabled(config.apiUrl);
}

/** Uses the external RAG API for retrieval (vs. keyword-only fallback). */
export function usesRagApi(config: Pick<RagDomainConfig, 'apiUrl'>): boolean {
  if (!isRagApiConfigured(config)) {
    logger.debug('[rag:config] RAG_API_URL not set; knowledge retrieval is keyword-only');
    return false;
  }
  return true;
}
