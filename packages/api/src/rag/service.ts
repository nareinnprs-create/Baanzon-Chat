import { logger } from '@librechat/data-schemas';
import type {
  KnowlEdgeCollection,
  CollectionScope,
  VectorChunk,
  CreateCollectionParams,
  AddDocumentParams,
  RetrieveParams,
  RetrievedSnippet,
  RetrievalSource,
} from './types';
import { chunkText } from './chunker';
import type { VectorStore, KnowledgeStore } from './types';
import { canWriteCollection } from './authorization';
import { randomUUID } from 'crypto';

export interface RagServiceDeps {
  config: {
    chunkSize: number;
    chunkOverlap: number;
    hybridAlpha: number;
    candidateK: number;
    topK: number;
    minScore: number;
  };
  knowledgeStore: KnowledgeStore;
  vectorStore: VectorStore;
  semantic?: {
    search(collectionId: string, query: string, limit: number): Promise<VectorChunk[]>;
  };
}

export interface RagService {
  createCollection(params: CreateCollectionParams): Promise<KnowlEdgeCollection>;
  listCollections(userId: string): Promise<KnowlEdgeCollection[]>;
  getCollection(userId: string, collectionId: string): Promise<KnowlEdgeCollection | null>;
  updateCollection(
    userId: string,
    collectionId: string,
    patch: CollectionPatch,
  ): Promise<KnowlEdgeCollection | null>;
  deleteCollection(userId: string, collectionId: string): Promise<boolean>;
  addDocument(params: AddDocumentParams): Promise<{ documentId: string; chunkCount: number }>;
  deleteDocument(userId: string, collectionId: string, documentId: string): Promise<boolean>;
  retrieve(params: RetrieveParams): Promise<RetrievedSnippet[]>;
}

type CollectionPatch = Partial<
  Pick<KnowlEdgeCollection, 'name' | 'description' | 'scope' | 'documentCount' | 'chunkCount'>
>;

const SCOPES: CollectionScope[] = ['private', 'project', 'global'];

const nowIso = (): string => new Date().toISOString();

function assertValidCollectionName(name: string): void {
  if (name.trim().length === 0 || name.trim().length > 64) {
    throw new Error('Collection name must be 1..64 characters');
  }
}

function keywordScore(text: string, query: string): number {
  const q = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (q.length === 0) {
    return 0;
  }
  const t = text.toLowerCase();
  let hits = 0;
  for (const tok of q) {
    if (t.includes(tok)) {
      hits += 1;
    }
  }
  return hits / q.length;
}

export function createRagService(deps: RagServiceDeps): RagService {
  const service: RagService = {
    async createCollection(params: CreateCollectionParams): Promise<KnowlEdgeCollection> {
      assertValidCollectionName(params.name);
      const scope: CollectionScope = SCOPES.includes(params.scope as CollectionScope)
        ? (params.scope as CollectionScope)
        : 'private';
      const id = randomUUID();
      const collection: KnowlEdgeCollection = {
        id,
        userId: params.userId,
        name: params.name.trim(),
        description: params.description,
        scope,
        chunkSize: params.chunkSize ?? deps.config.chunkSize,
        chunkOverlap: params.chunkOverlap ?? deps.config.chunkOverlap,
        documentCount: 0,
        chunkCount: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await deps.knowledgeStore.createCollection(collection);
      logger.debug(`[rag] created collection ${id} for user ${params.userId}`);
      return collection;
    },

    listCollections: (userId) => deps.knowledgeStore.listCollections(userId),

    async getCollection(userId, collectionId) {
      return deps.knowledgeStore.getCollection(userId, collectionId);
    },

    async updateCollection(userId, collectionId, patch) {
      const existing = await service.getCollection(userId, collectionId);
      if (!existing) {
        return null;
      }
      if (patch.name !== undefined) {
        assertValidCollectionName(patch.name);
      }
      return deps.knowledgeStore.updateCollection(userId, collectionId, {
        ...patch,
        updatedAt: nowIso(),
      });
    },

    async deleteCollection(userId, collectionId) {
      const existing = await service.getCollection(userId, collectionId);
      if (!existing) {
        return false;
      }
      await deps.vectorStore.deleteCollection(collectionId);
      return deps.knowledgeStore.deleteCollection(userId, collectionId);
    },

    async addDocument(params) {
      const collection = await service.getCollection(params.userId, params.collectionId);
      if (!collection) {
        throw new Error('Collection not found or access denied');
      }
      if (!canWriteCollection(params.userId, collection)) {
        throw new Error('Access denied');
      }
      const chunks = chunkText(params.content, collection.chunkSize, collection.chunkOverlap);
      if (chunks.length === 0) {
        throw new Error('Document contains no extractable text');
      }
      const documentId = randomUUID();
      const vectorChunks: VectorChunk[] = chunks.map((c) => ({
        collectionId: params.collectionId,
        documentId,
        chunkIndex: c.index,
        text: c.text,
        metadata: {
          ...(params.metadata ?? {}),
          source: params.source,
        },
      }));
      await deps.vectorStore.upsertChunks(params.collectionId, vectorChunks);
      await deps.knowledgeStore.updateCollection(params.userId, params.collectionId, {
        documentCount: collection.documentCount + 1,
        chunkCount: collection.chunkCount + vectorChunks.length,
        updatedAt: nowIso(),
      });
      logger.debug(
        `[rag] added document ${documentId} (${vectorChunks.length} chunks) to ${params.collectionId}`,
      );
      return { documentId, chunkCount: vectorChunks.length };
    },

    async deleteDocument(userId, collectionId, documentId) {
      const collection = await service.getCollection(userId, collectionId);
      if (!collection || !canWriteCollection(userId, collection)) {
        return false;
      }
      await deps.vectorStore.deleteDocument(collectionId, documentId);
      const remaining = Math.max(0, collection.documentCount - 1);
      await deps.knowledgeStore.updateCollection(userId, collectionId, {
        documentCount: remaining,
        updatedAt: nowIso(),
      });
      return true;
    },

    async retrieve(params) {
      const collection = await service.getCollection(params.userId, params.collectionId);
      if (!collection) {
        throw new Error('Collection not found or access denied');
      }
      const alpha = Math.max(0, Math.min(1, params.hybridAlpha ?? deps.config.hybridAlpha));
      const topK = params.topK ?? deps.config.topK;
      const candidateK = deps.config.candidateK;

      const semantic = deps.semantic
        ? await deps.semantic.search(params.collectionId, params.query, candidateK)
        : [];
      const keyword = deps.vectorStore.semanticSearch
        ? await deps.vectorStore.semanticSearch(params.collectionId, params.query, candidateK)
        : [];

      const byDocument = new Map<
        string,
        { chunk: VectorChunk; sem: number; kw: number }
      >();
      for (const chunk of semantic) {
        const entry = byDocument.get(chunk.documentId) ?? { chunk, sem: 0, kw: 0 };
        entry.sem = Math.max(entry.sem, 1);
        byDocument.set(chunk.documentId, entry);
      }
      for (const chunk of keyword) {
        const existing = byDocument.get(chunk.documentId);
        const entry = existing ?? { chunk, sem: 0, kw: 0 };
        entry.kw = Math.max(entry.kw, keywordScore(chunk.text, params.query));
        if (!existing) {
          byDocument.set(chunk.documentId, entry);
        }
      }

      const minScore = deps.config.minScore;
      const snippets: RetrievedSnippet[] = [];
      for (const { chunk, sem, kw } of byDocument.values()) {
        const score = alpha * sem + (1 - alpha) * kw;
        if (score < minScore) {
          continue;
        }
        const source: RetrievalSource =
          sem > 0 && kw > 0 ? 'hybrid' : sem > 0 ? 'semantic' : 'keyword';
        snippets.push({
          collectionId: params.collectionId,
          documentId: chunk.documentId,
          text: chunk.text,
          score,
          source,
          chunkIndex: chunk.chunkIndex,
          metadata: chunk.metadata,
        });
      }

      snippets.sort((a, b) => b.score - a.score);
      return snippets.slice(0, topK);
    },
  };

  return service;
}
