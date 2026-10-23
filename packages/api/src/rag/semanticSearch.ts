/**
 * Semantic search service for the RAG domain (B1.2; blueprint §22 semantics).
 *
 * Fills the `semantic?` slot of `RagServiceDeps`: given a collection, a query
 * and a result limit, return the collection's vector chunks in best-match
 * order. The rag service's hybrid `retrieve` merges these candidates with the
 * keyword path (alpha-weighted).
 *
 * Module-boundary compliant:
 *  - `EmbeddingsProvider` and the optional `Reranker` are injected by the
 *    caller (provider-agnostic; never import an SDK / external RAG client).
 *  - No storage engine import: candidates come from the injected
 *    `VectorStore` (`semanticSearch`), matching the keyword path's contract.
 *  - No HTTP, no logger, no runner import.
 */
import type { VectorChunk, VectorStore } from './types';
import type { RagDomainConfig } from './config';

/** Provider-agnostic embedding source (injected at the module boundary). */
export interface EmbeddingsProvider {
  /** Fixed vector dimension reported by the provider. */
  readonly dimension: number;
  /** Embed a single piece of text into a `dimension`-length vector. */
  embed(text: string): Promise<number[]>;
}

/** Optional reranker; when absent, cosine order stands. */
export interface Reranker {
  /** Re-score `candidates` against `query` and return them best-first. */
  rerank(query: string, candidates: VectorChunk[]): Promise<VectorChunk[]>;
}

/** What the semantic service needs from the caller — all injected. */
export interface SemanticSearchDeps {
  config: Pick<RagDomainConfig, 'candidateK' | 'topK' | 'minScore'>;
  /** Vector store used to fetch candidate chunks for a collection. */
  vectorStore: VectorStore;
  /** Embedding provider (required for true semantic scoring). */
  embeddings: EmbeddingsProvider;
  /** Optional reranker (semantic reordering of candidates). */
  reranker?: Reranker;
}

/** The semantic search service (shape matches `RagServiceDeps['semantic']`). */
export interface SemanticSearchService {
  search(collectionId: string, query: string, limit: number): Promise<VectorChunk[]>;
}

/**
 * Cosine similarity between two equal-length vectors. Returns 0 on
 * dimension mismatch / empty / zero-norm input.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Build the semantic search service. Fetches `candidateK` candidates from the
 * injected vector store, embeds the query, scores candidates by cosine,
 * applies the optional reranker, and returns `min(topK, limit)` best-first.
 */
export function createSemanticSearchService(deps: SemanticSearchDeps): SemanticSearchService {
  return {
    async search(collectionId: string, query: string, limit: number) {
      const trimmed = query.trim();
      if (trimmed.length === 0) {
        return [];
      }
      const candidates = await deps.vectorStore.semanticSearch(
        collectionId,
        trimmed,
        deps.config.candidateK,
      );
      if (candidates.length === 0) {
        return [];
      }
      const qvec = await deps.embeddings.embed(trimmed);
      const scored = candidates
        .map((chunk) => ({ chunk, score: cosineSimilarity(qvec, chunk.embedding ?? []) }))
        .filter((s) => s.score >= deps.config.minScore)
        .sort((a, b) => b.score - a.score)
        .map((s) => s.chunk);
      const topK = scored.slice(0, Math.min(limit, deps.config.topK));
      return deps.reranker ? deps.reranker.rerank(trimmed, topK) : topK;
    },
  };
}
