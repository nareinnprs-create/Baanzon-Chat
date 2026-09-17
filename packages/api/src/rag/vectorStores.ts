/**
 * In-memory vector store for the RAG domain (blueprint §20 / §24).
 * Used for tests + dev when no external RAG API is configured.
 * Interface mirrors {@link VectorStore} from `~/types`.
 */
import type { VectorChunk } from './types';

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

/**
 * Zero-dependency keyword/semantic-ish scorer.
 * Scores chunks by token-overlap of the query (Jaccard on token sets).
 */
export class InMemoryVectorStore {
  private stores = new Map<string, Map<string, VectorChunk[]>>();

  async upsertChunks(collectionId: string, chunks: VectorChunk[]): Promise<void> {
    const map = this.stores.get(collectionId) ?? new Map<string, VectorChunk[]>();
    this.stores.set(collectionId, map);
    for (const chunk of chunks) {
      const list = map.get(chunk.documentId) ?? [];
      const existing = list.findIndex((c) => c.chunkIndex === chunk.chunkIndex);
      if (existing >= 0) {
        list[existing] = chunk;
      } else {
        list.push(chunk);
      }
      map.set(chunk.documentId, list);
    }
  }

  async semanticSearch(collectionId: string, query: string, limit: number): Promise<VectorChunk[]> {
    const map = this.stores.get(collectionId) ?? new Map<string, VectorChunk[]>();
    if (!map) {
      return [];
    }
    const q = tokenize(query);
    const scored: Array<{ chunk: VectorChunk; score: number }> = [];
    for (const chunks of map.values()) {
      for (const chunk of chunks) {
        const c = tokenize(chunk.text);
        if (c.size === 0) {
          continue;
        }
        let inter = 0;
        for (const tok of q) {
          if (c.has(tok)) {
            inter += 1;
          }
        }
        const union = q.size + c.size - inter;
        const score = union === 0 ? 0 : inter / union;
        scored.push({ chunk, score });
      }
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.chunk);
  }

  async deleteDocument(collectionId: string, documentId: string): Promise<void> {
    const map = this.stores.get(collectionId) ?? new Map<string, VectorChunk[]>();
  }

  async deleteCollection(collectionId: string): Promise<void> {
    this.stores.delete(collectionId);
  }
}


