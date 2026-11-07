import { SystemRoles } from 'librechat-data-provider';
import type { KnowledgeCollection, KnowledgeCollectionListing, RetrievedSnippet } from './types';
import type { HandlerResult, RagHandlers } from './handlers';
import type { RagActor } from './authorization';
import type { RagService } from './service';
import { RagError, capacityExceeded, forbidden } from './errors';
import { createRagHandlers } from './handlers';

const ADMIN: RagActor = { role: SystemRoles.ADMIN };

const COLLECTION: KnowledgeCollection = {
  id: 'col-1',
  userId: 'u-1',
  name: 'handbook',
  scope: 'private',
  chunkSize: 800,
  chunkOverlap: 80,
  documentCount: 0,
  chunkCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/**
 * The page plus the count it is measured against, as the service returns it.
 * Pinned here rather than left to the service default so a handler that starts
 * reshaping the listing — dropping `total`, recomputing `hasMore` — fails
 * instead of quietly changing what a client can say.
 */
const LISTING: KnowledgeCollectionListing = {
  collections: [COLLECTION],
  total: 1,
  hasMore: false,
  capacity: null,
};

/** A driver message names the deployment's internals and must never reach a response. */
const INTERNAL = 'MongoServerSelectionError: db-a:27017';

function makeService(overrides: Partial<RagService> = {}): RagService {
  return {
    createCollection: jest.fn(async () => COLLECTION),
    listCollections: jest.fn(async () => LISTING),
    getCollection: jest.fn(async () => COLLECTION),
    updateCollection: jest.fn(async () => COLLECTION),
    deleteCollection: jest.fn(async () => true),
    addDocument: jest.fn(async () => ({ documentId: 'doc-1', chunkCount: 2 })),
    deleteDocument: jest.fn(async () => true),
    retrieve: jest.fn(async () => []),
    ...overrides,
  } as RagService;
}

describe('createRagHandlers', () => {
  describe('updateCollection', () => {
    it('returns the 404 result for a collection the service cannot see', async () => {
      const service = makeService({ updateCollection: jest.fn(async () => null) });
      const handlers = createRagHandlers(service);

      const result = await handlers.updateCollection('u-1', 'missing', { name: 'renamed' });

      expect(result).toEqual({ ok: false, status: 404, message: 'Not Found' });
    });

    it('passes the ids and patch through and returns the collection on success', async () => {
      const updated = { ...COLLECTION, name: 'renamed' };
      const updateCollection = jest.fn(async () => updated);
      const handlers = createRagHandlers(makeService({ updateCollection }));

      const result = await handlers.updateCollection('u-1', 'col-1', { name: 'renamed' });

      expect(updateCollection).toHaveBeenCalledWith('u-1', 'col-1', { name: 'renamed' }, undefined);
      expect(result).toEqual({ ok: true, data: updated });
    });

    it('forwards a patch that carries no keys at all', async () => {
      const updateCollection = jest.fn(async () => COLLECTION);
      const handlers = createRagHandlers(makeService({ updateCollection }));

      await handlers.updateCollection('u-1', 'col-1', {});

      expect(updateCollection).toHaveBeenCalledWith('u-1', 'col-1', {}, undefined);
    });
  });

  describe('sibling result mapping', () => {
    it('maps a missing getCollection to the 404 result', async () => {
      const handlers = createRagHandlers(makeService({ getCollection: jest.fn(async () => null) }));

      expect(await handlers.getCollection('u-1', 'missing')).toEqual({
        ok: false,
        status: 404,
        message: 'Not Found',
      });
    });

    it('maps a failed deleteCollection to the 404 result', async () => {
      const handlers = createRagHandlers(
        makeService({ deleteCollection: jest.fn(async () => false) }),
      );

      expect(await handlers.deleteCollection('u-1', 'missing')).toEqual({
        ok: false,
        status: 404,
        message: 'Not Found',
      });
    });

    it('maps a failed deleteDocument to the 404 result', async () => {
      const handlers = createRagHandlers(
        makeService({ deleteDocument: jest.fn(async () => false) }),
      );

      expect(await handlers.deleteDocument('u-1', 'col-1', 'doc-1')).toEqual({
        ok: false,
        status: 404,
        message: 'Not Found',
      });
    });

    it('regression: maps a null retrieve to the 404 result rather than a 200 empty list', async () => {
      const handlers = createRagHandlers(makeService({ retrieve: jest.fn(async () => null) }));

      expect(
        await handlers.retrieve({ userId: 'u-1', collectionId: 'missing', query: 'rag' }),
      ).toEqual({ ok: false, status: 404, message: 'Not Found' });
    });

    it('passes a non-null retrieve payload straight through', async () => {
      const handlers = createRagHandlers(
        makeService({
          retrieve: jest.fn(async () => [] as RetrievedSnippet[]),
        }),
      );

      expect(
        await handlers.retrieve({ userId: 'u-1', collectionId: 'col-1', query: 'rag' }),
      ).toEqual({ ok: true, data: [] });
    });

    it('returns listCollections payloads as-is, count and capacity included', async () => {
      const handlers = createRagHandlers(makeService());

      expect(await handlers.listCollections('u-1')).toEqual({ ok: true, data: LISTING });
    });

    it('hands the caller through untouched: the handler must not recount or re-cap', async () => {
      // The count is a second read the service already made. A handler that
      // recomputed it from the page would turn `total: 250` back into `200`
      // and reintroduce exactly the defect the field exists to remove.
      const listing: KnowledgeCollectionListing = {
        collections: [COLLECTION],
        total: 250,
        hasMore: true,
        capacity: { remainingChunks: 0, remainingCollections: 0 },
      };
      const handlers = createRagHandlers(
        makeService({ listCollections: jest.fn(async () => listing) }),
      );

      expect(await handlers.listCollections('u-1')).toEqual({ ok: true, data: listing });
    });
  });

  describe('mapThrown classification', () => {
    const addDocument = { userId: 'u-1', collectionId: 'col-1', content: 'text' };

    it.each([400, 403, 404] as const)(
      'carries a RagError status %i and its message through to the response',
      async (status) => {
        const message = `domain failure ${status}`;
        const handlers = createRagHandlers(
          makeService({
            addDocument: jest.fn(async () => {
              throw new RagError(message, status);
            }),
          }),
        );

        expect(await handlers.addDocument(addDocument)).toEqual({
          ok: false,
          status,
          message,
        });
      },
    );

    it('does not leak a plain Error message: a driver fault is a bare 500 Internal error', async () => {
      const handlers = createRagHandlers(
        makeService({
          addDocument: jest.fn(async () => {
            throw new Error(INTERNAL);
          }),
        }),
      );

      const result = await handlers.addDocument(addDocument);

      expect(result).toEqual({ ok: false, status: 500, message: 'Internal error' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).not.toContain('MongoServerSelectionError');
        expect(result.message).not.toContain('db-a:27017');
      }
    });

    it("maps a throw that is not an Error — a bare 'boom' string — to the bare 500", async () => {
      const handlers = createRagHandlers(
        makeService({
          addDocument: jest.fn(async () => {
            throw 'boom';
          }),
        }),
      );

      expect(await handlers.addDocument(addDocument)).toEqual({
        ok: false,
        status: 500,
        message: 'Internal error',
      });
    });

    /**
     * The real failure, not a stand-in for it. A full store raises
     * `capacityExceeded` (`errors.ts:53`, a `RagError` carrying 409), so this
     * throws that rather than a plain `Error` with the same words in it: a bare
     * `Error` is answered with the generic 500, so the previous version of this
     * test asserted 500 and passed unchanged if `capacityExceeded` regressed to
     * one — the exact regression its name pins. The typed error is what
     * separates "this deployment is full" from "the database is down", so the
     * status, the operator hint and the absence of a 500 are all the assertion.
     */
    it('regression: a store-capacity error is a 409, not a client mistake or a 500', async () => {
      const message =
        'In-memory vector store is full (2 chunks); configure a persistent vector store or raise inMemoryMaxChunks';
      const handlers = createRagHandlers(
        makeService({
          addDocument: jest.fn(async () => {
            throw capacityExceeded(message);
          }),
        }),
      );

      const result = await handlers.addDocument(addDocument);

      // The exact match is the whole assertion: 409 is neither the 400 a client
      // mistake gets nor the 500 an untyped throw gets, and the operator hint
      // survives to the caller.
      expect(result).toEqual({ ok: false, status: 409, message });
    });
  });

  describe('no handler lets a service failure escape', () => {
    type HandlerName = keyof RagHandlers;

    /** One entry per handler: the service method it calls, and how to call it. */
    const CASES: [HandlerName, (handlers: RagHandlers) => Promise<HandlerResult<unknown>>][] = [
      [
        'createCollection',
        (handlers) => handlers.createCollection({ userId: 'u-1', name: 'hand' }),
      ],
      ['listCollections', (handlers) => handlers.listCollections('u-1')],
      ['getCollection', (handlers) => handlers.getCollection('u-1', 'col-1')],
      [
        'updateCollection',
        (handlers) => handlers.updateCollection('u-1', 'col-1', { name: 'renamed' }),
      ],
      ['deleteCollection', (handlers) => handlers.deleteCollection('u-1', 'col-1')],
      [
        'addDocument',
        (handlers) =>
          handlers.addDocument({ userId: 'u-1', collectionId: 'col-1', content: 'text' }),
      ],
      ['deleteDocument', (handlers) => handlers.deleteDocument('u-1', 'col-1', 'doc-1')],
      [
        'retrieve',
        (handlers) => handlers.retrieve({ userId: 'u-1', collectionId: 'col-1', query: 'rag' }),
      ],
    ];

    it.each(CASES)(
      '%s turns a plain Error from the service into a bare 500 instead of escaping',
      async (method, call) => {
        const thrower = jest.fn(async () => {
          throw new Error(INTERNAL);
        });
        const handlers = createRagHandlers(
          makeService({ [method]: thrower } as unknown as Partial<RagService>),
        );

        expect(await call(handlers)).toEqual({
          ok: false,
          status: 500,
          message: 'Internal error',
        });
        expect(thrower).toHaveBeenCalled();
      },
    );
  });

  describe('scope enforcement on update', () => {
    it("surfaces the service's scope denial as 403 with its message", async () => {
      const updateCollection = jest.fn(async () => {
        throw forbidden('Collection scope not permitted: nonsense');
      });
      const handlers = createRagHandlers(makeService({ updateCollection }));

      const result = await handlers.updateCollection('u-1', 'col-1', {
        scope: 'nonsense' as never,
      });

      expect(result).toEqual({
        ok: false,
        status: 403,
        message: 'Collection scope not permitted: nonsense',
      });
      expect(updateCollection).toHaveBeenCalledWith(
        'u-1',
        'col-1',
        { scope: 'nonsense' },
        undefined,
      );
    });

    it('allows a permitted scope through to the service', async () => {
      const updateCollection = jest.fn(
        async (): Promise<KnowledgeCollection> => ({ ...COLLECTION, scope: 'global' }),
      );
      const handlers = createRagHandlers(makeService({ updateCollection }));

      const result = await handlers.updateCollection('u-1', 'col-1', { scope: 'global' });

      expect(updateCollection).toHaveBeenCalledWith('u-1', 'col-1', { scope: 'global' }, undefined);
      expect(result.ok).toBe(true);
    });

    it('does not scope-check a patch that carries no scope', async () => {
      const updateCollection = jest.fn(async () => COLLECTION);
      const handlers = createRagHandlers(makeService({ updateCollection }));

      await handlers.updateCollection('u-1', 'col-1', { name: 'renamed' });

      expect(updateCollection).toHaveBeenCalledTimes(1);
    });
  });

  describe('createCollection', () => {
    it('returns the created collection, not an opaque value', async () => {
      const handlers = createRagHandlers(makeService());

      const result = await handlers.createCollection({ userId: 'u-1', name: 'handbook' });

      expect(result).toEqual({ ok: true, data: COLLECTION });
    });
  });

  /**
   * The actor is the handler's only way to tell the service who is asking, and
   * it is a plain optional argument rather than anything ambient: the handlers
   * are built once per runtime and reused across requests, so there is nowhere
   * request-scoped to put it. These pin that the role survives the hop — if a
   * future signature drops it, an admin's `global` request silently degrades to
   * a 403 with nothing else failing.
   */
  describe('the actor reaches the service', () => {
    it('forwards the role on create', async () => {
      const createCollection = jest.fn(async () => COLLECTION);
      const handlers = createRagHandlers(makeService({ createCollection }));

      await handlers.createCollection(
        { userId: 'admin-1', name: 'shared', scope: 'global' },
        ADMIN,
      );

      expect(createCollection).toHaveBeenCalledWith(
        { userId: 'admin-1', name: 'shared', scope: 'global' },
        ADMIN,
      );
    });

    it('forwards the role on update', async () => {
      const updateCollection = jest.fn(async () => COLLECTION);
      const handlers = createRagHandlers(makeService({ updateCollection }));

      await handlers.updateCollection('admin-1', 'col-1', { scope: 'global' }, ADMIN);

      expect(updateCollection).toHaveBeenCalledWith('admin-1', 'col-1', { scope: 'global' }, ADMIN);
    });

    it('passes no actor when the route had no role to give', async () => {
      // Fail-closed rests on this: the service treats a missing actor as
      // not-an-admin, so dropping the argument must not become a way in.
      const createCollection = jest.fn(async () => COLLECTION);
      const handlers = createRagHandlers(makeService({ createCollection }));

      await handlers.createCollection({ userId: 'u-1', name: 'handbook' });

      expect(createCollection).toHaveBeenCalledWith({ userId: 'u-1', name: 'handbook' }, undefined);
    });
  });
});
