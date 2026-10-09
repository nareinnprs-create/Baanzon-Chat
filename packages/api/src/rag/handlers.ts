/*
 * HTTP-surface adapters for the RAG domain.
 *
 * These are plain, dependency-injected handlers bound to the RagService so the
 * Express Router stays in the server package. No express runtime import here
 * (express is not a runtime dependency of this workspace); the returned
 * functions take request DTOs and return response DTOs.
 */
import { logger } from '@librechat/data-schemas';
import type {
  AddDocumentParams,
  CollectionPatch,
  CreateCollectionParams,
  KnowledgeCollection,
  KnowledgeCollectionListing,
  RetrievedSnippet,
  RetrieveParams,
} from './types';
import type { AddDocumentResult, RagService } from './service';
import type { RagActor } from './authorization';
import { RagError } from './errors';

export type HandlerResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

export interface RagHandlers {
  /**
   * `actor` carries the caller's role from the request. It is forwarded
   * unchanged rather than inspected here: the service is the enforcement point
   * for what a caller may do, and this layer only shapes DTOs and statuses.
   */
  createCollection(
    params: CreateCollectionParams,
    actor?: RagActor,
  ): Promise<HandlerResult<KnowledgeCollection>>;
  listCollections(userId: string): Promise<HandlerResult<KnowledgeCollectionListing>>;
  getCollection(userId: string, collectionId: string): Promise<HandlerResult<KnowledgeCollection>>;
  updateCollection(
    userId: string,
    collectionId: string,
    patch: CollectionPatch,
    actor?: RagActor,
  ): Promise<HandlerResult<KnowledgeCollection>>;
  deleteCollection(userId: string, collectionId: string): Promise<HandlerResult<boolean>>;
  /**
   * The whole ingest result, not just its two always-true counters. The
   * optional caveats (`ledgerStale`, `embedding`) were already reaching the
   * response at runtime while this signature named a narrower type, so a client
   * reading them off the body had no contract to read them from; naming the
   * service's own result type is what makes them part of the API rather than an
   * accident of the object passed through.
   */
  addDocument(params: AddDocumentParams): Promise<HandlerResult<AddDocumentResult>>;
  deleteDocument(
    userId: string,
    collectionId: string,
    documentId: string,
  ): Promise<HandlerResult<boolean>>;
  retrieve(params: RetrieveParams): Promise<HandlerResult<RetrievedSnippet[]>>;
}

const missing = (message = 'Not Found'): HandlerResult<never> => ({
  ok: false,
  status: 404,
  message,
});

/**
 * Classify by the error's declared status. Anything that is not a `RagError` is
 * an internal fault: it is logged and reported as a bare 500, because a driver
 * message (`MongoServerSelectionError: …`) would otherwise tell a caller about
 * the deployment's internals. The domain's `RagError` messages are written for
 * the caller and do reach the response.
 */
function mapThrown(err: unknown): HandlerResult<never> {
  if (err instanceof RagError) {
    return { ok: false, status: err.status, message: err.message };
  }
  logger.error('[rag] unexpected domain error', err);
  return { ok: false, status: 500, message: 'Internal error' };
}

export function createRagHandlers(service: RagService): RagHandlers {
  return {
    async createCollection(params, actor) {
      try {
        return { ok: true, data: await service.createCollection(params, actor) };
      } catch (err) {
        return mapThrown(err);
      }
    },

    async listCollections(userId) {
      try {
        return { ok: true, data: await service.listCollections(userId) };
      } catch (err) {
        return mapThrown(err);
      }
    },

    async getCollection(userId, collectionId) {
      try {
        const collection = await service.getCollection(userId, collectionId);
        if (!collection) {
          return missing();
        }
        return { ok: true, data: collection };
      } catch (err) {
        return mapThrown(err);
      }
    },

    async updateCollection(userId, collectionId, patch, actor) {
      try {
        const collection = await service.updateCollection(userId, collectionId, patch, actor);
        if (!collection) {
          return missing();
        }
        return { ok: true, data: collection };
      } catch (err) {
        return mapThrown(err);
      }
    },

    async deleteCollection(userId, collectionId) {
      try {
        const deleted = await service.deleteCollection(userId, collectionId);
        if (!deleted) {
          return missing();
        }
        return { ok: true, data: deleted };
      } catch (err) {
        return mapThrown(err);
      }
    },

    async addDocument(params) {
      try {
        return { ok: true, data: await service.addDocument(params) };
      } catch (err) {
        return mapThrown(err);
      }
    },

    async deleteDocument(userId, collectionId, documentId) {
      try {
        const deleted = await service.deleteDocument(userId, collectionId, documentId);
        if (!deleted) {
          return missing();
        }
        return { ok: true, data: deleted };
      } catch (err) {
        return mapThrown(err);
      }
    },

    async retrieve(params) {
      try {
        const snippets = await service.retrieve(params);
        if (snippets == null) {
          return missing();
        }
        return { ok: true, data: snippets };
      } catch (err) {
        return mapThrown(err);
      }
    },
  };
}
