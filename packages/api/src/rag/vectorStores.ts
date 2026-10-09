/**
 * In-memory vector store for the RAG domain (blueprint §20 / §24).
 * Used for tests + dev when no external RAG API is configured.
 * Interface mirrors {@link VectorStore} from `~/types`.
 */
import type { VectorChunk, VectorStore } from './types';
import { capacityExceeded } from './errors';

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

/** The store's own record of what it holds — the only count that is not a ledger. */
function countIn(map: Map<string, VectorChunk[]> | undefined): number {
  if (!map) {
    return 0;
  }
  let total = 0;
  for (const chunks of map.values()) {
    total += chunks.length;
  }
  return total;
}

export interface InMemoryVectorStoreOptions {
  /** Refuse new collections past this count; 0 = unlimited. */
  maxCollections?: number;
  /** Refuse new chunks past this count; 0 = unlimited. */
  maxChunks?: number;
}

/**
 * Zero-dependency keyword/semantic-ish scorer.
 * Scores chunks by token-overlap of the query (Jaccard on token sets).
 */
export class InMemoryVectorStore implements VectorStore {
  private stores = new Map<string, Map<string, VectorChunk[]>>();
  private maxCollections: number;
  private maxChunks: number;

  constructor(options: InMemoryVectorStoreOptions = {}) {
    this.maxCollections = options.maxCollections ?? 0;
    this.maxChunks = options.maxChunks ?? 0;
  }

  /**
   * The store is process-scoped, but its limits come from per-request config,
   * so the resolver applies them once resolved rather than rebuilding the index.
   */
  applyLimits(options: InMemoryVectorStoreOptions): void {
    this.maxCollections = options.maxCollections ?? 0;
    this.maxChunks = options.maxChunks ?? 0;
  }

  private get chunkCount(): number {
    let total = 0;
    for (const map of this.stores.values()) {
      total += countIn(map);
    }
    return total;
  }

  /** Re-upserting an existing (documentId, chunkIndex) replaces, so it is not new. */
  private countNewChunks(collectionId: string, incoming: VectorChunk[]): number {
    const map = this.stores.get(collectionId);
    if (!map) {
      return incoming.length;
    }
    let added = 0;
    const seen = new Set<string>();
    for (const chunk of incoming) {
      const existing = map.get(chunk.documentId);
      if (existing != null && existing.some((c) => c.chunkIndex === chunk.chunkIndex)) {
        continue;
      }
      const key = `${chunk.documentId}:${chunk.chunkIndex}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      added += 1;
    }
    return added;
  }

  private assertCapacity(collectionId: string, incoming: VectorChunk[]): void {
    if (this.maxCollections > 0 && !this.stores.has(collectionId)) {
      if (this.stores.size >= this.maxCollections) {
        throw capacityExceeded(
          `In-memory vector store is full (${this.maxCollections} collections)`,
        );
      }
    }
    if (this.maxChunks > 0) {
      const projected = this.chunkCount + this.countNewChunks(collectionId, incoming);
      if (projected > this.maxChunks) {
        throw capacityExceeded(
          `In-memory vector store is full (${this.maxChunks} chunks); ` +
            `configure a persistent vector store or raise inMemoryMaxChunks`,
        );
      }
    }
  }

  async upsertChunk(collectionId: string, chunk: VectorChunk): Promise<void> {
    await this.upsertChunks(collectionId, [chunk]);
  }

  async upsertChunks(collectionId: string, chunks: VectorChunk[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }
    this.assertCapacity(collectionId, chunks);
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
    const map = this.stores.get(collectionId);
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

  async deleteDocument(collectionId: string, documentId: string): Promise<number> {
    const map = this.stores.get(collectionId);
    const chunks = map?.get(documentId);
    if (!map || chunks == null) {
      return 0;
    }
    const removed = chunks.length;
    map.delete(documentId);
    if (map.size === 0) {
      this.stores.delete(collectionId);
    }
    return removed;
  }

  async deleteCollection(collectionId: string): Promise<void> {
    this.stores.delete(collectionId);
  }

  /**
   * Counts the chunks this process actually holds, which is the honest answer
   * after a restart: the process-scoped index is empty then, whatever the
   * durable collection ledger still says.
   */
  async countChunks(collectionId: string): Promise<number> {
    return countIn(this.stores.get(collectionId));
  }
}
