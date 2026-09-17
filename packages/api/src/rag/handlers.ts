/*
 * HTTP-surface adapters for the RAG domain.
 *
 * These are plain, dependency-injected handlers bound to the RagService so the
 * Express Router stays in the server package. No express runtime import here
 * (express is not a runtime dependency of this workspace); the returned
 * functions take request DTOs and return response DTOs.
 */
import type { RagService } from './service';
import type {
  AddDocumentParams,
  CreateCollectionParams,
  RetrievedSnippet,
  RetrieveParams,
} from './types';
export interface RagHandlers {
  createCollection(
    params: CreateCollectionParams,
  ): Promise<{ ok: true; data: unknown } | { ok: false; status: number; message: string }>;
  listCollections(
    userId: string,
  ): Promise<{ ok: true; data: unknown } | { ok: false; status: number; message: string }>;
  getCollection(
    userId: string,
    collectionId: string,
  ): Promise<{ ok: true; data: unknown } | { ok: false; status: number; message: string }>;
  deleteCollection(
    userId: string,
    collectionId: string,
  ): Promise<{ ok: true; data: boolean } | { ok: false; status: number; message: string }>;
  addDocument(
    params: AddDocumentParams,
  ): Promise<{ ok: true; data: unknown } | { ok: false; status: number; message: string }>;
  deleteDocument(
    userId: string,
    collectionId: string,
    documentId: string,
  ): Promise<{ ok: true; data: boolean } | { ok: false; status: number; message: string }>;
  retrieve(params: RetrieveParams): Promise<{ ok: true; data: RetrievedSnippet[] } | {
    ok: false;
    status: number;
    message: string;
  }>;
}

function denied(message = 'Forbidden'): { ok: false; status: number; message: string } {
  return { ok: false, status: 403, message };
}

function missing(message = 'Not Found'): { ok: false; status: number; message: string } {
  return { ok: false, status: 404, message };
}

function invalid(message: string): { ok: false; status: number; message: string } {
  return { ok: false, status: 400, message };
}

export function createRagHandlers(service: RagService): RagHandlers {
  return {
    async createCollection(params) {
      const collection = await service.createCollection(params);
      if (!collection) {
        return denied('Collection scope not permitted');
      }
      return collection ? { ok: true, data: collection } : denied();
    },

    async listCollections(userId) {
      const collections = await service.listCollections(userId);
      return { ok: true, data: collections };
    },

    async getCollection(userId, collectionId) {
      const collection = await service.getCollection(userId, collectionId);
      if (!collection) {
        return missing();
      }
      return { ok: true, data: collection };
    },

    async deleteCollection(userId, collectionId) {
      const deleted = await service.deleteCollection(userId, collectionId);
      if (!deleted) {
        return missing();
      }
      return { ok: true, data: deleted };
    },

    async addDocument(params) {
      try {
        const result = await service.addDocument(params);
        return { ok: true, data: result };
      } catch (err) {
        return invalid((err as Error).message);
      }
    },

    async deleteDocument(userId, collectionId, documentId) {
      const deleted = await service.deleteDocument(userId, collectionId, documentId);
      if (!deleted) {
        return missing();
      }
      return { ok: true, data: deleted };
    },

    async retrieve(params) {
      const snippets = await service.retrieve(params);
      if (snippets.length === 0) {
        return { ok: true, data: [] };
      }
      return { ok: true, data: snippets };
    },
  };
}