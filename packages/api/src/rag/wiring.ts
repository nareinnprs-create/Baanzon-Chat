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
 */
import type { RagDomainConfig } from './config';
import type { VectorChunk, VectorStore } from './types';
import type { ChunkEmbedder } from './embeddings';
import { createOpenAIEmbeddings } from './openaiEmbeddings';
import { createSemanticSearchService } from './semanticSearch';
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
  /** Retrieval tuning for the semantic candidates; defaults to `RAG_DEFAULTS`. */
  config?: Pick<RagDomainConfig, 'candidateK' | 'topK' | 'minScore'>;
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
 */
export function createRagIntegration(options: RagIntegrationOptions): RagIntegration {
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
    vectorStore: options.vectorStore,
    embeddings: queryEmbedder,
  });
  return { embedder: chunkEmbedder, semantic };
}
