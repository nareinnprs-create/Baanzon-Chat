import { SystemRoles } from 'librechat-data-provider';
import type { Response } from 'express';
import type { KnowledgeCollection, CollectionStatsDelta } from './types';
import type { MongoKnowledgeStoreDeps } from './knowledgeStore';
import type { ChunkEmbedder } from './embeddings';
import type { RagRoutes } from './routes';
import { InMemoryVectorStore } from './vectorStores';
import { createRagRoutes } from './routes';

type RagRouteRequest = Parameters<RagRoutes['createCollection']>[0];
type AppConfig = NonNullable<RagRouteRequest['config']>;
type RagUser = NonNullable<RagRouteRequest['user']>;

/**
 * `req.user` as `requireJwtAuth` populates it: the passport user document, with
 * `id` the string form of `_id` and `role` a `SystemRoles` value.
 */
const ADMIN: RagUser = { id: 'admin-1', role: SystemRoles.ADMIN };
const USER: RagUser = { id: 'u-1', role: SystemRoles.USER };

function createResponse(): Response {
  const response = {} as Response;
  response.status = jest.fn(() => response);
  response.json = jest.fn(() => response);
  return response;
}

/**
 * The RAG block is set on every request rather than left to resolve from
 * nothing, so no test here depends on what `rag.disabled` currently defaults
 * to. `Object.assign` means a caller can still pass `config: undefined` to
 * exercise the no-config path deliberately.
 */
const ENABLED_CONFIG = { rag: { disabled: false } } as AppConfig;

function createRequest(overrides: Partial<RagRouteRequest> = {}): RagRouteRequest {
  return Object.assign(
    {} as RagRouteRequest,
    { body: {}, params: {}, config: ENABLED_CONFIG },
    overrides,
  );
}

/**
 * `pageSize` caps what the list returns without touching the count, which is
 * what the real store does at `KNOWLEDGE_COLLECTION_LIST_LIMIT`: the page stops
 * and the caller is none the wiser unless something else says how much there
 * is. Default `undefined` = uncapped, so every other test in this file is
 * unaffected.
 */
function makeKnowledgeMethods(pageSize?: number) {
  const rows = new Map<string, KnowledgeCollection>();
  const visible = (userId: string) =>
    [...rows.values()].filter((r) => r.userId === userId || r.scope === 'global');
  return {
    createKnowledgeCollection: jest.fn(async (input: Record<string, unknown>) => {
      const now = new Date().toISOString();
      const row = {
        ...(input as unknown as KnowledgeCollection),
        documentCount: 0,
        chunkCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(row.id, row);
      return row;
    }),
    getKnowledgeCollection: jest.fn(async (userId: string, collectionId: string) => {
      const row = rows.get(collectionId);
      if (row == null) {
        return null;
      }
      return row.userId === userId || row.scope === 'global' ? row : null;
    }),
    listKnowledgeCollections: jest.fn(async (userId: string) =>
      pageSize == null ? visible(userId) : visible(userId).slice(0, pageSize),
    ),
    /** The real methods object carries this too; the runtime reads it off here. */
    countKnowledgeCollections: jest.fn(async (userId: string) => visible(userId).length),
    updateKnowledgeCollection: jest.fn(
      async (userId: string, collectionId: string, patch: Partial<KnowledgeCollection>) => {
        const row = rows.get(collectionId);
        if (row == null || row.userId !== userId) {
          return null;
        }
        const next = { ...row, ...patch };
        rows.set(collectionId, next);
        return next;
      },
    ),
    bumpKnowledgeCollectionStats: jest.fn(
      async (userId: string, collectionId: string, delta: CollectionStatsDelta) => {
        const row = rows.get(collectionId);
        if (row == null || row.userId !== userId) {
          return null;
        }
        // Read, add and write with no `await` in between: that is what makes this atomic, as Mongo's `$inc` is, so never split it into a read-then-write.
        const next = {
          ...row,
          documentCount: row.documentCount + delta.documentDelta,
          chunkCount: row.chunkCount + delta.chunkDelta,
          updatedAt: new Date().toISOString(),
        };
        rows.set(collectionId, next);
        return next;
      },
    ),
    deleteKnowledgeCollection: jest.fn(async (userId: string, collectionId: string) => {
      const row = rows.get(collectionId);
      if (row == null || row.userId !== userId) {
        return false;
      }
      rows.delete(collectionId);
      return true;
    }),
  };
}

function setup(
  overrides: {
    disabled?: boolean;
    vectorStore?: InMemoryVectorStore;
    pageSize?: number;
    embedder?: ChunkEmbedder;
  } = {},
) {
  const knowledgeMethods = makeKnowledgeMethods(overrides.pageSize);
  const vectorStore = overrides.vectorStore ?? new InMemoryVectorStore();
  const config = { rag: { disabled: overrides.disabled ?? false } } as AppConfig;
  const routes = createRagRoutes({
    knowledgeMethods: knowledgeMethods as unknown as MongoKnowledgeStoreDeps,
    vectorStore,
    ...(overrides.embedder ? { embedder: overrides.embedder } : {}),
  });
  return { routes, knowledgeMethods, vectorStore, config };
}

const bodyOf = (response: Response): unknown => jest.mocked(response.json).mock.calls[0][0];
const statusOf = (response: Response): number | undefined =>
  jest.mocked(response.status).mock.calls[0]?.[0];

/**
 * `userId` and `role` stand in for the passport document `requireJwtAuth` puts
 * on `req.user`; they are passed separately because these tests read as
 * "this person", not as request plumbing. `USER` is the default because a
 * caller that does not care about the role is asserting it is not an admin.
 */
async function createOne(
  routes: RagRoutes,
  userId = 'u-1',
  body: Record<string, unknown> = { name: 'handbook', scope: 'private' },
  config?: AppConfig,
  role: string = SystemRoles.USER,
): Promise<string> {
  const response = createResponse();
  await routes.createCollection(
    createRequest({
      body,
      user: { id: userId, role },
      params: {},
      ...(config ? { config } : {}),
    }),
    response,
  );
  expect(statusOf(response)).toBe(201);
  return (bodyOf(response) as KnowledgeCollection).id;
}

async function addDoc(
  routes: RagRoutes,
  collectionId: string,
  content = 'the rag service chunks text into pieces',
  userId = 'u-1',
  body: Record<string, unknown> = {},
  config?: AppConfig,
): Promise<Response> {
  const response = createResponse();
  await routes.addDocument(
    createRequest({
      body: { content, ...body },
      user: { id: userId },
      params: { collectionId },
      ...(config ? { config } : {}),
    }),
    response,
  );
  return response;
}

const FIRST_DOC =
  'the rag service chunks text into pieces and every piece keeps a reference back to the document it came from';
const SECOND_DOC =
  'retrieval reads the pieces back, scores them against the query and returns the best snippets to the caller';

/** Small enough that the documents above chunk into several pieces. */
function smallChunkConfig(): AppConfig {
  return { rag: { disabled: false, chunkSize: 40, chunkOverlap: 8 } } as AppConfig;
}

async function collectionOf(
  routes: RagRoutes,
  collectionId: string,
  userId = 'u-1',
): Promise<KnowledgeCollection> {
  const response = createResponse();
  await routes.getCollection(
    createRequest({ user: { id: userId }, params: { collectionId } }),
    response,
  );
  expect(statusOf(response)).toBe(200);
  return (bodyOf(response) as { collection: KnowledgeCollection }).collection;
}

describe('createRagRoutes', () => {
  describe('unauthenticated requests', () => {
    it('falls back to an empty userId instead of throwing when req.user is undefined', async () => {
      const { routes } = setup();
      const response = createResponse();

      await expect(
        routes.createCollection(
          createRequest({ body: { name: 'handbook', scope: 'private' }, params: {} }),
          response,
        ),
      ).resolves.toBeDefined();

      expect(statusOf(response)).toBe(201);
      expect((bodyOf(response) as KnowledgeCollection).userId).toBe('');
    });

    it('stores the empty userId, so the collection is reachable only as the anonymous owner', async () => {
      const { routes } = setup();
      const anonymous = createResponse();
      await routes.createCollection(
        createRequest({ body: { name: 'anon', scope: 'private' }, params: {} }),
        anonymous,
      );
      const id = (bodyOf(anonymous) as KnowledgeCollection).id;

      const asAnonymous = createResponse();
      await routes.getCollection(
        createRequest({ user: { id: '' }, params: { collectionId: id } }),
        asAnonymous,
      );
      expect(statusOf(asAnonymous)).toBe(200);
      expect((bodyOf(asAnonymous) as { collection: KnowledgeCollection }).collection.id).toBe(id);

      const asStranger = createResponse();
      await routes.getCollection(
        createRequest({ user: { id: 'u-9' }, params: { collectionId: id } }),
        asStranger,
      );
      expect(statusOf(asStranger)).toBe(404);
    });
  });

  describe('validation', () => {
    it('answers 400 with the validator message when the name is missing', async () => {
      const { routes, knowledgeMethods } = setup();
      const response = createResponse();

      await routes.createCollection(createRequest({ body: {} }), response);

      expect(statusOf(response)).toBe(400);
      expect(response.json).toHaveBeenCalledWith({ error: 'name is required' });
      expect(knowledgeMethods.createKnowledgeCollection).not.toHaveBeenCalled();
    });

    it('answers 400 with the validator message when the scope is unknown', async () => {
      const { routes } = setup();
      const response = createResponse();

      await routes.createCollection(
        createRequest({ body: { name: 'handbook', scope: 'nope' } as never }),
        response,
      );

      expect(statusOf(response)).toBe(400);
      expect(response.json).toHaveBeenCalledWith({
        error: 'scope must be one of: private, global',
      });
    });

    it('answers 400 and writes nothing for the unsupported project scope, for any role', async () => {
      // `project` is not a scope this deployment has, so the answer is 400
      // whatever role the caller holds — including an admin, which is what
      // distinguishes it from `global` (403, below). It used to be accepted
      // here and stored as a scope that behaves exactly like `private`, so a
      // client could mint phantom project collections through the API.
      for (const user of [ADMIN, USER, { id: 'u-1' } as RagUser, undefined]) {
        const { routes, knowledgeMethods } = setup();
        const response = createResponse();

        await routes.createCollection(
          createRequest({ body: { name: 'handbook', scope: 'project' } as never, user }),
          response,
        );

        expect(statusOf(response)).toBe(400);
        expect(response.json).toHaveBeenCalledWith({
          error: 'scope must be one of: private, global',
        });
        expect(knowledgeMethods.createKnowledgeCollection).not.toHaveBeenCalled();
      }
    });

    it('answers 400 with the validator message when the document content is missing', async () => {
      const { routes } = setup();
      const response = createResponse();

      await routes.addDocument(
        createRequest({ body: {}, user: { id: 'u-1' }, params: { collectionId: 'col-1' } }),
        response,
      );

      expect(statusOf(response)).toBe(400);
      expect(response.json).toHaveBeenCalledWith({ error: 'content is required' });
    });

    it('answers 400 when the route path carries no collectionId', async () => {
      const { routes } = setup();
      const response = createResponse();

      await routes.addDocument(
        createRequest({ body: { content: 'text' }, user: { id: 'u-1' }, params: {} }),
        response,
      );

      expect(statusOf(response)).toBe(400);
      expect(response.json).toHaveBeenCalledWith({ error: 'collectionId is required' });
    });

    it('answers 400 with the validator message when the retrieve query is missing', async () => {
      const { routes } = setup();
      const response = createResponse();

      await routes.retrieve(
        createRequest({ body: {}, user: { id: 'u-1' }, params: { collectionId: 'col-1' } }),
        response,
      );

      expect(statusOf(response)).toBe(400);
      expect(response.json).toHaveBeenCalledWith({ error: 'query is required' });
    });

    it('answers 400 with the validator message when the patch name is blank', async () => {
      const { routes } = setup();
      const response = createResponse();

      await routes.updateCollection(
        createRequest({ body: { name: '   ' }, params: { collectionId: 'col-1' } }),
        response,
      );

      expect(statusOf(response)).toBe(400);
      expect(response.json).toHaveBeenCalledWith({ error: 'name must be 1..64 characters' });
    });

    it('answers 400 when the patch carries an invalid scope', async () => {
      const { routes } = setup();
      const response = createResponse();

      await routes.updateCollection(
        createRequest({
          body: { scope: 'nope' } as never,
          params: { collectionId: 'col-1' },
        }),
        response,
      );

      expect(statusOf(response)).toBe(400);
      expect(response.json).toHaveBeenCalledWith({
        error: 'scope must be one of: private, global',
      });
    });

    it('answers 400 when the patch description is over-long', async () => {
      const { routes } = setup();
      const response = createResponse();

      await routes.updateCollection(
        createRequest({
          body: { description: 'x'.repeat(513) },
          params: { collectionId: 'col-1' },
        }),
        response,
      );

      expect(statusOf(response)).toBe(400);
      expect(response.json).toHaveBeenCalledWith({
        error: 'description must be <= 512 characters',
      });
    });

    it('accepts a description of exactly the maximum length', async () => {
      const { routes } = setup();
      const id = await createOne(routes);
      const response = createResponse();

      await routes.updateCollection(
        createRequest({
          user: { id: 'u-1' },
          body: { description: 'y'.repeat(512) },
          params: { collectionId: id },
        }),
        response,
      );

      expect(statusOf(response)).toBe(200);
    });

    it('answers 400 when the create description is over-long', async () => {
      const { routes } = setup();
      const response = createResponse();

      await routes.createCollection(
        createRequest({ body: { name: 'ok', description: 'x'.repeat(513) } }),
        response,
      );

      expect(statusOf(response)).toBe(400);
      expect(response.json).toHaveBeenCalledWith({
        error: 'description must be <= 512 characters',
      });
    });
  });

  describe('success status mapping', () => {
    it('answers createCollection with 201', async () => {
      const { routes } = setup();
      const response = createResponse();

      await routes.createCollection(
        createRequest({ body: { name: 'handbook', scope: 'private' }, user: { id: 'u-1' } }),
        response,
      );

      expect(statusOf(response)).toBe(201);
    });

    it('answers addDocument with 201', async () => {
      const { routes } = setup();
      const id = await createOne(routes);
      const response = createResponse();

      await routes.addDocument(
        createRequest({
          body: { content: 'the rag service chunks text', source: 'a.txt' },
          user: { id: 'u-1' },
          params: { collectionId: id },
        }),
        response,
      );

      expect(statusOf(response)).toBe(201);
      expect(bodyOf(response)).toEqual(
        expect.objectContaining({ documentId: expect.any(String), chunkCount: 1 }),
      );
    });

    /**
     * The last hop of the degradation contract. The service reports the gap, the
     * handler types it, and the route maps `addDocument`'s result straight through —
     * so a client can only branch on it if nothing on the way out drops it. That
     * makes this route the last place the field could silently disappear, which is
     * why the assertion is on the wire body rather than on the service.
     */
    it('carries the embedding report through to the response body', async () => {
      const { routes } = setup({
        embedder: { embed: () => Promise.reject(new Error('provider down')) },
      });
      const id = await createOne(routes);
      const response = createResponse();

      await routes.addDocument(
        createRequest({
          body: { content: 'the rag service chunks text', source: 'a.txt' },
          user: { id: 'u-1' },
          params: { collectionId: id },
        }),
        response,
      );

      // 201, not 5xx: the document was stored, and a client that retries on a
      // non-2xx would duplicate it.
      expect(statusOf(response)).toBe(201);
      expect(bodyOf(response)).toEqual({
        documentId: expect.any(String),
        chunkCount: 1,
        embedding: { embedded: 0, total: 1, degraded: 'failed' },
      });
    });

    it('omits the embedding field entirely when every chunk was embedded', async () => {
      const { routes } = setup({ embedder: { embed: async (texts) => texts.map(() => [1, 0]) } });
      const id = await createOne(routes);
      const response = createResponse();

      await routes.addDocument(
        createRequest({
          body: { content: 'the rag service chunks text', source: 'a.txt' },
          user: { id: 'u-1' },
          params: { collectionId: id },
        }),
        response,
      );

      // Absence is the success signal, so it has to actually be absent: a client
      // that branched on `embedding != null` would otherwise re-ingest forever.
      expect(bodyOf(response)).not.toHaveProperty('embedding');
    });

    it('regression: answers listCollections with an explicit 200', async () => {
      const { routes } = setup();
      const id = await createOne(routes);
      const listed = createResponse();

      await routes.listCollections(createRequest({ user: { id: 'u-1' } }), listed);

      // The mapped status is no longer dropped on the way out.
      expect(statusOf(listed)).toBe(200);
      expect(listed.json).toHaveBeenCalledWith({
        collections: [expect.objectContaining({ id })],
        total: 1,
        hasMore: false,
        capacity: null,
      });
    });

    it('answers getCollection, updateCollection, deleteCollection and deleteDocument with 200', async () => {
      const { routes } = setup();
      const id = await createOne(routes);

      const got = createResponse();
      await routes.getCollection(
        createRequest({ user: { id: 'u-1' }, params: { collectionId: id } }),
        got,
      );
      expect(statusOf(got)).toBe(200);

      const updated = createResponse();
      await routes.updateCollection(
        createRequest({
          user: { id: 'u-1' },
          body: { name: 'renamed' },
          params: { collectionId: id },
        }),
        updated,
      );
      expect(statusOf(updated)).toBe(200);
      expect(updated.json).toHaveBeenCalledWith({
        updated: true,
        collection: expect.objectContaining({ name: 'renamed' }),
      });

      const added = await addDoc(routes, id);
      const documentId = (bodyOf(added) as { documentId: string }).documentId;

      const deletedDoc = createResponse();
      await routes.deleteDocument(
        createRequest({
          user: { id: 'u-1' },
          params: { collectionId: id, documentId },
        }),
        deletedDoc,
      );
      expect(statusOf(deletedDoc)).toBe(200);
      expect(deletedDoc.json).toHaveBeenCalledWith({ deleted: true });

      const deleted = createResponse();
      await routes.deleteCollection(
        createRequest({ user: { id: 'u-1' }, params: { collectionId: id } }),
        deleted,
      );
      expect(statusOf(deleted)).toBe(200);
      expect(deleted.json).toHaveBeenCalledWith({ deleted: true });
    });

    it('answers retrieve with 200', async () => {
      const { routes } = setup();
      const id = await createOne(routes);
      await addDoc(routes, id);
      const response = createResponse();

      await routes.retrieve(
        createRequest({
          body: { query: 'rag service chunks' },
          user: { id: 'u-1' },
          params: { collectionId: id },
        }),
        response,
      );

      expect(statusOf(response)).toBe(200);
    });
  });

  describe('collectionId comes from the route path', () => {
    it('regression: a body collectionId cannot redirect an ingest to another collection', async () => {
      const { routes, vectorStore } = setup();
      const target = await createOne(routes);
      const decoy = await createOne(routes);

      const response = await addDoc(
        routes,
        target,
        'the rag service chunks text into pieces',
        'u-1',
        { collectionId: decoy },
      );

      expect(statusOf(response)).toBe(201);
      // Only the path collection received the vectors.
      expect(await vectorStore.semanticSearch(target, 'pieces', 10)).not.toHaveLength(0);
      expect(await vectorStore.semanticSearch(decoy, 'pieces', 10)).toHaveLength(0);
    });

    it('regression: a body collectionId cannot redirect a retrieve', async () => {
      const { routes, vectorStore } = setup();
      const seeded = await createOne(routes);
      const decoy = await createOne(routes);
      await addDoc(routes, seeded, 'the rag service chunks text into pieces');
      const documentId = (
        bodyOf(await addDoc(routes, seeded, 'a second rag document')) as {
          documentId: string;
        }
      ).documentId;
      await routes.deleteDocument(
        createRequest({
          user: { id: 'u-1' },
          params: { collectionId: seeded, documentId },
        }),
        createResponse(),
      );

      const response = createResponse();
      await routes.retrieve(
        createRequest({
          body: { query: 'pieces', collectionId: seeded },
          user: { id: 'u-1' },
          params: { collectionId: decoy },
        }),
        response,
      );

      expect(statusOf(response)).toBe(200);
      const body = bodyOf(response) as { snippets: unknown[] };
      expect(body.snippets).toEqual([]);
      expect(await vectorStore.semanticSearch(decoy, 'pieces', 10)).toHaveLength(0);
    });

    /**
     * The counters now move through the atomic bump rather than an absolute
     * `$set`, so the write is observed on `bumpKnowledgeCollectionStats`. It
     * must still land on the path collection only, and the absolute write must
     * stay gone: it is the one that loses a concurrent ingest's increment.
     */
    it('updates the metadata of the path collection, not the body one', async () => {
      const { routes, knowledgeMethods } = setup();
      const target = await createOne(routes);
      const decoy = await createOne(routes);

      const response = await addDoc(
        routes,
        target,
        'the rag service chunks text into pieces',
        'u-1',
        { collectionId: decoy },
      );
      const { chunkCount } = bodyOf(response) as { documentId: string; chunkCount: number };

      const calls = knowledgeMethods.bumpKnowledgeCollectionStats.mock.calls;
      expect(calls).toHaveLength(1);
      const [userId, collectionId, delta] = calls[0];
      expect(userId).toBe('u-1');
      expect(collectionId).toBe(target);
      expect(delta).toEqual({ documentDelta: 1, chunkDelta: chunkCount });
      expect(knowledgeMethods.updateKnowledgeCollection).not.toHaveBeenCalled();

      const decoyRow = await collectionOf(routes, decoy);
      expect(decoyRow.documentCount).toBe(0);
      expect(decoyRow.chunkCount).toBe(0);
    });
  });

  /**
   * The delta is the observable half of the atomic bump: each ingest adds to
   * the counters rather than overwriting them with a value read earlier, so two
   * documents leave the sum behind, not the last one.
   */
  describe('ingest counters', () => {
    it('increments documentCount by one and chunkCount by the reported chunkCount', async () => {
      const { routes } = setup();
      const id = await createOne(routes, 'u-1', { name: 'handbook' }, smallChunkConfig());

      const response = await addDoc(routes, id, FIRST_DOC, 'u-1', {}, smallChunkConfig());
      const { chunkCount } = bodyOf(response) as { documentId: string; chunkCount: number };
      expect(chunkCount).toBeGreaterThan(1);

      const collection = await collectionOf(routes, id);
      expect(collection.documentCount).toBe(1);
      expect(collection.chunkCount).toBe(chunkCount);
    });

    it('accumulates across ingests rather than replacing the previous counts', async () => {
      const { routes } = setup();
      const config = smallChunkConfig();
      const id = await createOne(routes, 'u-1', { name: 'handbook' }, config);

      const first = bodyOf(await addDoc(routes, id, FIRST_DOC, 'u-1', {}, config)) as {
        chunkCount: number;
      };
      const second = bodyOf(await addDoc(routes, id, SECOND_DOC, 'u-1', {}, config)) as {
        chunkCount: number;
      };
      expect(first.chunkCount).toBeGreaterThan(1);
      expect(second.chunkCount).toBeGreaterThan(1);

      const collection = await collectionOf(routes, id);
      expect(collection.documentCount).toBe(2);
      expect(collection.chunkCount).toBe(first.chunkCount + second.chunkCount);
    });
  });

  describe('updateCollection patch', () => {
    it('forwards only the keys actually present in the body', async () => {
      const { routes, knowledgeMethods } = setup();
      const id = await createOne(routes);

      await routes.updateCollection(
        createRequest({
          user: { id: 'u-1' },
          body: { name: 'renamed' },
          params: { collectionId: id },
        }),
        createResponse(),
      );

      const patch = jest.mocked(knowledgeMethods.updateKnowledgeCollection).mock.calls[0][2];
      expect(patch).toEqual(expect.objectContaining({ name: 'renamed' }));
      expect(patch).not.toHaveProperty('description');
      expect(patch).not.toHaveProperty('scope');
    });

    it('forwards every user-editable key present in the body', async () => {
      const { routes, knowledgeMethods } = setup();
      const id = await createOne(routes);

      // The owner with the admin role, because `global` is the one scope a
      // plain user cannot set. The point here is the forwarding, so the request
      // has to be one the service will actually accept.
      await routes.updateCollection(
        createRequest({
          user: { id: 'u-1', role: SystemRoles.ADMIN },
          body: { name: 'renamed', description: 'now with a description', scope: 'global' },
          params: { collectionId: id },
        }),
        createResponse(),
      );

      const patch = jest.mocked(knowledgeMethods.updateKnowledgeCollection).mock.calls[0][2];
      expect(patch).toEqual(
        expect.objectContaining({
          name: 'renamed',
          description: 'now with a description',
          scope: 'global',
        }),
      );
    });

    it('regression: a request carrying the counters cannot change them', async () => {
      const { routes, knowledgeMethods } = setup();
      const id = await createOne(routes);
      await addDoc(routes, id);
      jest.mocked(knowledgeMethods.updateKnowledgeCollection).mockClear();

      const response = createResponse();
      await routes.updateCollection(
        createRequest({
          user: { id: 'u-1' },
          body: { name: 'renamed', documentCount: 999, chunkCount: 999, updatedAt: 'x' },
          params: { collectionId: id },
        }),
        response,
      );

      // Refused rather than accepted-and-ignored. Dropping the fields answered
      // 200 to a request that had tried to rewrite the ingest counters, which
      // reads to a caller as "applied" — and it paired a field the API refuses
      // outright on `POST` with a 200 here.
      expect(statusOf(response)).toBe(400);
      expect(bodyOf(response)).toEqual({
        error:
          'documentCount, chunkCount, updatedAt cannot be changed after a collection ' +
          'is created; a patch may only set name, description, scope',
      });
      expect(knowledgeMethods.updateKnowledgeCollection).not.toHaveBeenCalled();

      const read = createResponse();
      await routes.getCollection(
        createRequest({ user: { id: 'u-1' }, params: { collectionId: id } }),
        read,
      );
      const collection = (bodyOf(read) as { collection: KnowledgeCollection }).collection;
      expect(collection.documentCount).toBe(1);
      expect(collection.chunkCount).toBe(1);
    });

    /**
     * The inconsistency this closes: the same field, the same API, two answers.
     * `POST` with a `chunkSize` of 0 is a 400 from `validation.ts`, so a caller
     * had one field that was refused on create and acknowledged on patch — and
     * re-chunking is precisely what cannot be done, because the documents are
     * already stored at the geometry the collection was created with.
     */
    it('answers 400 for a chunkSize patch, where the same field on create is a 400 too', async () => {
      const { routes, knowledgeMethods } = setup();
      const id = await createOne(routes);

      const created = createResponse();
      await routes.createCollection(
        createRequest({ body: { name: 'kb', chunkSize: 0 } as never, user: { id: 'u-1' } }),
        created,
      );
      const patched = createResponse();
      await routes.updateCollection(
        createRequest({
          body: { chunkSize: 0 },
          user: { id: 'u-1' },
          params: { collectionId: id },
        }),
        patched,
      );

      expect(statusOf(created)).toBe(400);
      expect(statusOf(patched)).toBe(400);
      expect(bodyOf(patched)).toEqual({
        error:
          'chunkSize cannot be changed after a collection is created; ' +
          'a patch may only set name, description, scope',
      });
      expect(knowledgeMethods.updateKnowledgeCollection).not.toHaveBeenCalled();
    });

    /**
     * Every immutable field, and the ordering of the message is the order they
     * are declared in rather than the order the body carries them, so two
     * bodies naming the same fields cannot produce two messages.
     */
    it.each([
      ['id', 'col-hijacked'],
      ['userId', 'u-2'],
      ['chunkSize', 64],
      ['chunkOverlap', 8],
      ['documentCount', 99],
      ['chunkCount', 99],
      ['createdAt', '2020-01-01T00:00:00.000Z'],
      ['updatedAt', '2020-01-01T00:00:00.000Z'],
    ])('refuses a patch carrying %s', async (field, value) => {
      const { routes, knowledgeMethods } = setup();
      const id = await createOne(routes);

      const response = createResponse();
      await routes.updateCollection(
        createRequest({
          body: { [field]: value } as never,
          user: { id: 'u-1' },
          params: { collectionId: id },
        }),
        response,
      );

      expect(statusOf(response)).toBe(400);
      expect(bodyOf(response)).toEqual({
        error:
          `${field} cannot be changed after a collection is created; ` +
          'a patch may only set name, description, scope',
      });
      expect(knowledgeMethods.updateKnowledgeCollection).not.toHaveBeenCalled();
    });

    /**
     * The refusal is about the collection's own fields, not about anything
     * unrecognised: a key from another API is dropped as before, so a rename
     * carrying one still succeeds. The `global`-promotion case below is the
     * reason this matters — a body smuggling a `role` must still be answered
     * with the 403 the admin gate gives, not a 400 about the shape of the body.
     */
    it.each(['role', 'tenantId', 'notAField'])('ignores an unrecognised key %s', async (key) => {
      const { routes, knowledgeMethods } = setup();
      const id = await createOne(routes);

      const response = createResponse();
      await routes.updateCollection(
        createRequest({
          body: { name: 'renamed', [key]: 'anything' } as never,
          user: { id: 'u-1' },
          params: { collectionId: id },
        }),
        response,
      );

      expect(statusOf(response)).toBe(200);
      // The service stamps `updatedAt` on every patch, so the assertion is on
      // the key set rather than an exact object.
      expect(
        Object.keys(jest.mocked(knowledgeMethods.updateKnowledgeCollection).mock.calls[0][2]),
      ).toEqual(['name', 'updatedAt']);
    });

    it('forwards no mutable key at all for an empty body', async () => {
      const { routes, knowledgeMethods } = setup();
      const id = await createOne(routes);

      await routes.updateCollection(
        createRequest({ user: { id: 'u-1' }, body: {}, params: { collectionId: id } }),
        createResponse(),
      );

      const patch = jest.mocked(knowledgeMethods.updateKnowledgeCollection).mock.calls[0][2];
      expect(Object.keys(patch).sort()).toEqual(['updatedAt']);
    });
  });

  describe('response envelopes', () => {
    it('wraps retrieve results as { snippets }', async () => {
      const { routes } = setup();
      const id = await createOne(routes);
      await addDoc(routes, id);
      const response = createResponse();

      await routes.retrieve(
        createRequest({
          body: { query: 'rag service chunks' },
          user: { id: 'u-1' },
          params: { collectionId: id },
        }),
        response,
      );

      const body = bodyOf(response) as { snippets: Array<{ text: string; chunkIndex: number }> };
      expect(Object.keys(body)).toEqual(['snippets']);
      expect(Array.isArray(body.snippets)).toBe(true);
      expect(body.snippets.length).toBeGreaterThan(0);
      expect(body.snippets[0].text).toContain('rag service chunks');
    });

    /**
     * The envelope is pinned key-for-key, and not only to prove the new fields
     * are there: the *order and set* is what tells a future edit that `total` is
     * the count of everything visible rather than the length of the page, and
     * that `capacity` belongs to the same response. `collections` is still the
     * first key and still the only one the client's list needs.
     */
    it('wraps listCollections as the page plus the count it is measured against', async () => {
      const { routes } = setup();
      await createOne(routes);
      await createOne(routes, 'u-1', { name: 'runbook', scope: 'private' });
      const response = createResponse();

      await routes.listCollections(createRequest({ user: { id: 'u-1' } }), response);

      const body = bodyOf(response) as { collections: KnowledgeCollection[] };
      expect(Object.keys(body)).toEqual(['collections', 'total', 'hasMore', 'capacity']);
      expect(body.collections.map((c) => c.name).sort()).toEqual(['handbook', 'runbook']);
    });
    it('wraps getCollection as { collection }', async () => {
      const { routes } = setup();
      const id = await createOne(routes);
      const response = createResponse();

      await routes.getCollection(
        createRequest({ user: { id: 'u-1' }, params: { collectionId: id } }),
        response,
      );

      expect(bodyOf(response)).toEqual({ collection: expect.objectContaining({ id }) });
    });
  });

  /**
   * The list was silently capped: a caller with more collections than the page
   * holds received a page that looked complete, and a header count derived from
   * its length read as the whole truth. These pin the two sentences apart — the
   * page is everything, or the page is the first of more — on the same route a
   * client already reaches, with no new endpoint and no change to `collections`.
   */
  describe('listCollections says what the page is', () => {
    const list = async (routes: RagRoutes, userId = 'u-1') => {
      const response = createResponse();
      await routes.listCollections(createRequest({ user: { id: userId } }), response);
      expect(statusOf(response)).toBe(200);
      return bodyOf(response) as {
        collections: KnowledgeCollection[];
        total: number;
        hasMore: boolean;
        capacity: { remainingChunks: number | null; remainingCollections: number | null } | null;
      };
    };

    /** Creates `count` collections, oldest first, and returns their ids in order. */
    async function createMany(routes: RagRoutes, count: number): Promise<string[]> {
      const ids: string[] = [];
      for (let index = 0; index < count; index += 1) {
        ids.push(await createOne(routes, 'u-1', { name: `collection ${index}`, scope: 'private' }));
      }
      return ids;
    }

    it('reports a total above the page length, so a client can say "showing 3 of 5"', async () => {
      const { routes } = setup({ pageSize: 3 });
      await createMany(routes, 5);

      const body = await list(routes);

      expect(body.collections).toHaveLength(3);
      expect(body.total).toBe(5);
      expect(body.hasMore).toBe(true);
    });

    it('reports no more when the page holds everything', async () => {
      const { routes } = setup({ pageSize: 3 });
      await createMany(routes, 2);

      const body = await list(routes);

      expect(body.collections).toHaveLength(2);
      expect(body.total).toBe(2);
      expect(body.hasMore).toBe(false);
    });

    it('states zero rather than leaving "none" to be inferred from a full page', async () => {
      const { routes } = setup({ pageSize: 3 });

      const body = await list(routes);

      // A cap can only ever produce a *full* page, never an empty one, so this is
      // the one case the empty state turns on: the count says outright that the
      // caller has nothing, rather than the page being assumed to.
      expect(body.collections).toEqual([]);
      expect(body.total).toBe(0);
      expect(body.hasMore).toBe(false);
    });

    it('counts another user private collection for nobody', async () => {
      const { routes } = setup({ pageSize: 3 });
      await createMany(routes, 2);
      await createOne(routes, 'u-2', { name: 'theirs', scope: 'private' });

      expect((await list(routes, 'u-1')).total).toBe(2);
      expect((await list(routes, 'u-2')).total).toBe(1);
    });

    /**
     * The interaction the capped list makes worth asking about: freeing a slot
     * has to make the collection behind the cap reachable, or a user with more
     * collections than fit could never see — or delete — the ones they cannot
     * see. Nothing in the list or delete path caches or pins a count: the page
     * is re-read from the store on every call and the count beside it is read
     * at the same time, so the two cannot drift apart.
     */
    it('brings the collection behind the cap into reach once one above it is deleted', async () => {
      const { routes } = setup({ pageSize: 3 });
      const ids = await createMany(routes, 4);
      const hidden = ids[3];

      const before = await list(routes);
      expect(before.collections.map((c) => c.id)).not.toContain(hidden);
      expect(before.total).toBe(4);

      const deleted = createResponse();
      await routes.deleteCollection(
        createRequest({ user: { id: 'u-1' }, params: { collectionId: ids[0] } }),
        deleted,
      );
      expect(statusOf(deleted)).toBe(200);

      const after = await list(routes);
      expect(after.collections.map((c) => c.id)).toContain(hidden);
      expect(after.collections).toHaveLength(3);
      expect(after.total).toBe(3);
      expect(after.hasMore).toBe(false);
    });

    it('keeps reporting hasMore while the cap is still hiding collections', async () => {
      const { routes } = setup({ pageSize: 3 });
      const ids = await createMany(routes, 5);

      const response = createResponse();
      await routes.deleteCollection(
        createRequest({ user: { id: 'u-1' }, params: { collectionId: ids[0] } }),
        response,
      );

      const after = await list(routes);
      expect(after.collections).toHaveLength(3);
      expect(after.total).toBe(4);
      expect(after.hasMore).toBe(true);
    });

    it('answers capacity as null for a store that does not report one', async () => {
      const { routes } = setup({ pageSize: 3 });
      await createMany(routes, 1);

      // Not `{ remainingChunks: 0, remainingCollections: 0 }`: a fresh process is
      // not a full one, and a client told "0 left" would refuse work the
      // deployment can still do.
      expect((await list(routes)).capacity).toBeNull();
    });

    it('passes the store capacity through when the store has one to give', async () => {
      const store = new InMemoryVectorStore();
      const reported = { remainingChunks: 11_420, remainingCollections: 137 };
      const withCapacity = Object.assign(store, { capacity: () => reported });
      const { routes } = setup({ pageSize: 3, vectorStore: withCapacity });
      await createMany(routes, 1);

      expect((await list(routes)).capacity).toEqual(reported);
    });

    it('leaves the whole payload alone when rag.disabled is on', async () => {
      const { routes, config } = setup({ disabled: true, pageSize: 3 });
      await createMany(routes, 5);
      const response = createResponse();

      await routes.listCollections(createRequest({ user: { id: 'u-1' }, config }), response);

      // The kill switch still answers 503 with the same top-level error, so the
      // new fields never appear next to a refusal.
      expect(statusOf(response)).toBe(503);
      expect(bodyOf(response)).toEqual({ error: 'Knowledge retrieval is disabled' });
    });
  });

  /**
   * Every route funnels through `reply`, which returns a top-level `{ error }`
   * and applies the resource-key wrapper to success bodies only. These
   * assertions pin that: a future route that wraps a failure in a resource key
   * is a contract break, because a client would then need a different parse path
   * per endpoint.
   */
  describe('uniform top-level error envelope', () => {
    const FAILING_CALLS: Array<
      [string, (routes: RagRoutes, response: Response) => Promise<unknown>]
    > = [
      [
        'getCollection',
        (routes, response) =>
          routes.getCollection(
            createRequest({ user: { id: 'u-1' }, params: { collectionId: 'missing' } }),
            response,
          ),
      ],
      [
        'updateCollection',
        (routes, response) =>
          routes.updateCollection(
            createRequest({
              user: { id: 'u-1' },
              body: { name: 'renamed' },
              params: { collectionId: 'missing' },
            }),
            response,
          ),
      ],
      [
        'deleteCollection',
        (routes, response) =>
          routes.deleteCollection(
            createRequest({ user: { id: 'u-1' }, params: { collectionId: 'missing' } }),
            response,
          ),
      ],
      [
        'deleteDocument',
        (routes, response) =>
          routes.deleteDocument(
            createRequest({
              user: { id: 'u-1' },
              params: { collectionId: 'missing', documentId: 'doc-404' },
            }),
            response,
          ),
      ],
      [
        'retrieve',
        (routes, response) =>
          routes.retrieve(
            createRequest({
              user: { id: 'u-1' },
              body: { query: 'rag' },
              params: { collectionId: 'missing' },
            }),
            response,
          ),
      ],
      [
        'addDocument',
        (routes, response) =>
          routes.addDocument(
            createRequest({
              user: { id: 'u-1' },
              body: { content: 'text' },
              params: { collectionId: 'missing' },
            }),
            response,
          ),
      ],
    ];

    it.each(FAILING_CALLS)(
      '%s answers a top-level { error } with no nested wrapper',
      async (_n, call) => {
        const { routes } = setup();
        const response = createResponse();

        await call(routes, response);

        const body = bodyOf(response) as Record<string, unknown>;
        expect(body).toEqual({ error: expect.any(String) });
      },
    );

    it.each(FAILING_CALLS)('%s still answers the domain status', async (_name, call) => {
      const { routes } = setup();
      const response = createResponse();

      await call(routes, response);

      expect([400, 403, 404, 500]).toContain(statusOf(response));
    });

    /**
     * RFC 9110 §15.5.4: a resource that does not exist is a 404, which is what
     * the five sibling routes above already answer for the same condition. The
     * 403 that survives is the one the caller can see and may not write — see
     * `global scope authorization` below, which asserts the pair.
     */
    it('maps a collection that does not exist to 404 on addDocument', async () => {
      const { routes } = setup();
      const response = createResponse();

      await routes.addDocument(
        createRequest({
          body: { content: 'text' },
          user: { id: 'u-1' },
          params: { collectionId: 'missing' },
        }),
        response,
      );

      expect(statusOf(response)).toBe(404);
      expect(bodyOf(response)).toEqual({ error: 'Collection not found' });
    });

    it('maps a missing document to 404 on deleteDocument', async () => {
      const { routes } = setup();
      const id = await createOne(routes);
      const response = createResponse();

      await routes.deleteDocument(
        createRequest({
          user: { id: 'u-1' },
          params: { collectionId: id, documentId: 'doc-404' },
        }),
        response,
      );

      expect(statusOf(response)).toBe(404);
    });

    it('maps a missing collection to 404 on retrieve', async () => {
      const { routes } = setup();
      const response = createResponse();

      await routes.retrieve(
        createRequest({
          user: { id: 'u-1' },
          body: { query: 'rag' },
          params: { collectionId: 'missing' },
        }),
        response,
      );

      expect(statusOf(response)).toBe(404);
    });

    /**
     * A configured ceiling is a typed `RagError`, so it keeps its status and
     * its message: 409 rather than the 500 a plain `Error` produced, and the
     * operator hint reaches the caller instead of dying in the log. A 5xx here
     * would tell a client the deployment is broken when the truth is that it is
     * full and the request is fine.
     */
    it('maps a store-capacity failure on addDocument to 409 with the ceiling named', async () => {
      // The runtime re-applies limits from the request config, so the ceiling
      // has to arrive on the request rather than on the store constructor.
      const config = { rag: { disabled: false, inMemoryMaxChunks: 1 } } as AppConfig;
      const { routes } = setup();
      const id = await createOne(routes, 'u-1', { name: 'handbook' }, config);

      const first = await addDoc(routes, id, 'first rag document', 'u-1', {}, config);
      expect(statusOf(first)).toBe(201);

      const response = await addDoc(
        routes,
        id,
        'a second distinct rag document',
        'u-1',
        {},
        config,
      );

      expect(statusOf(response)).toBe(409);
      expect(bodyOf(response)).toEqual({
        error: expect.stringContaining('inMemoryMaxChunks'),
      });
    });

    it('maps a scope the caller may not use on update to a client error', async () => {
      const { routes } = setup();
      const id = await createOne(routes);
      const response = createResponse();

      await routes.updateCollection(
        createRequest({
          user: { id: 'u-1' },
          body: { scope: 'nope' } as never,
          params: { collectionId: id },
        }),
        response,
      );

      // Validation rejects the unknown scope before the handler sees it.
      expect(statusOf(response)).toBe(400);
      expect(bodyOf(response)).toEqual({
        error: 'scope must be one of: private, global',
      });
    });
  });

  describe('global scope authorization', () => {
    const seedGlobal = async (
      routes: RagRoutes,
      vectorStore: InMemoryVectorStore,
    ): Promise<string> => {
      // Created by an admin: publishing to `global` is admin-only, so the
      // fixture cannot be seeded by the plain user the assertions run as. The
      // user in every test below is deliberately not the creator, which is the
      // point — global is readable by anyone and writable only by an admin.
      const id = await createOne(
        routes,
        'admin-1',
        { name: 'shared', scope: 'global' },
        undefined,
        SystemRoles.ADMIN,
      );
      await addDoc(routes, id, 'the rag service chunks text into pieces', 'admin-1');
      expect(await vectorStore.semanticSearch(id, 'pieces', 10)).not.toHaveLength(0);
      return id;
    };

    it('lets a non-owner read a global collection', async () => {
      const { routes, vectorStore } = setup();
      const id = await seedGlobal(routes, vectorStore);
      const response = createResponse();

      await routes.getCollection(
        createRequest({ user: { id: 'u-2' }, params: { collectionId: id } }),
        response,
      );

      expect(statusOf(response)).toBe(200);
      expect((bodyOf(response) as { collection: KnowledgeCollection }).collection.id).toBe(id);
    });

    it('lets a non-owner retrieve from a global collection', async () => {
      const { routes, vectorStore } = setup();
      const id = await seedGlobal(routes, vectorStore);
      const response = createResponse();

      await routes.retrieve(
        createRequest({
          user: { id: 'u-2' },
          body: { query: 'rag service chunks' },
          params: { collectionId: id },
        }),
        response,
      );

      expect(statusOf(response)).toBe(200);
      expect((bodyOf(response) as { snippets: unknown[] }).snippets.length).toBeGreaterThan(0);
    });

    /**
     * The vector-store half is the point that matters for authorization: a
     * non-owner's delete must not reach the store. The 403 is deliberate — the
     * collection was already returned to this caller at 200, so "not found"
     * would be a claim they can disprove. The client reads a 404 from a delete
     * as success (`client/src/data-provider/Knowledge/mutations.ts`), which would
     * make a shared collection vanish from the non-owner's list while still
     * serving everyone else.
     */
    it('regression: a non-owner delete leaves the vectors in place', async () => {
      const { routes, vectorStore } = setup();
      const id = await seedGlobal(routes, vectorStore);
      const response = createResponse();

      await routes.deleteCollection(
        createRequest({ user: { id: 'u-2' }, params: { collectionId: id } }),
        response,
      );

      expect(statusOf(response)).toBe(403);
      expect(bodyOf(response)).toEqual({ error: 'Access denied' });
      expect(await vectorStore.semanticSearch(id, 'pieces', 10)).not.toHaveLength(0);
    });

    it('regression: a non-owner document delete leaves the vectors in place', async () => {
      const { routes, vectorStore } = setup();
      const id = await seedGlobal(routes, vectorStore);
      const before = (await vectorStore.semanticSearch(id, 'pieces', 10)).length;
      const response = createResponse();

      await routes.deleteDocument(
        createRequest({
          user: { id: 'u-2' },
          params: { collectionId: id, documentId: 'whatever' },
        }),
        response,
      );

      expect(statusOf(response)).toBe(403);
      expect(await vectorStore.semanticSearch(id, 'pieces', 10)).toHaveLength(before);
    });

    /**
     * A denial is a `RagError` with status 403, so it reaches the caller as 403
     * without the HTTP layer having to read the message. Reporting it as 500
     * would invite clients to retry a request that can never succeed and would
     * pollute server-error alerting.
     */
    it('rejects a non-owner write into a global collection', async () => {
      const { routes, vectorStore } = setup();
      const id = await seedGlobal(routes, vectorStore);
      const before = (await vectorStore.semanticSearch(id, 'pieces', 10)).length;

      const response = await addDoc(routes, id, 'an injection attempt from a stranger', 'u-2');

      expect(statusOf(response)).toBe(403);
      expect(bodyOf(response)).toEqual({ error: 'Access denied' });
      expect(await vectorStore.semanticSearch(id, 'pieces', 10)).toHaveLength(before);
    });

    /**
     * The two failure statuses on one route, side by side, so a future change
     * cannot collapse them: 404 is for a collection nobody can see (including
     * one that does not exist), 403 for a collection the caller demonstrably
     * can see and still may not write. Answering 404 in the second case would
     * be a different lie than answering 403 in the first.
     */
    it('distinguishes a collection that does not exist (404) from a shared one (403)', async () => {
      const { routes, vectorStore } = setup();
      const id = await seedGlobal(routes, vectorStore);

      const absent = await addDoc(routes, 'no-such-collection', 'anything at all', 'u-2');
      const notMine = await addDoc(routes, id, 'anything at all', 'u-2');

      expect(statusOf(absent)).toBe(404);
      expect(bodyOf(absent)).toEqual({ error: 'Collection not found' });
      expect(statusOf(notMine)).toBe(403);
      expect(bodyOf(notMine)).toEqual({ error: 'Access denied' });
    });

    /**
     * The counters are the collection's own accounting, so moving them is a
     * write: a non-owner who may read a `global` collection must not be able to
     * inflate it. The route denies the ingest outright, and the store behind it
     * filters on the owner, so a bump reaching the data layer as `u-2` is a
     * silent no-op rather than a corruption.
     */
    it('regression: a non-owner cannot move a global collection counters', async () => {
      const { routes, knowledgeMethods, vectorStore } = setup();
      const id = await seedGlobal(routes, vectorStore);
      const before = await collectionOf(routes, id);

      const response = await addDoc(routes, id, 'an injection attempt from a stranger', 'u-2');

      expect(statusOf(response)).toBe(403);
      const after = await collectionOf(routes, id);
      expect(after.documentCount).toBe(before.documentCount);
      expect(after.chunkCount).toBe(before.chunkCount);
      // The only bump this collection ever saw is its owner's own ingest.
      expect(
        knowledgeMethods.bumpKnowledgeCollectionStats.mock.calls.filter(
          ([, collectionId]) => collectionId === id,
        ),
      ).toEqual([['admin-1', id, { documentDelta: 1, chunkDelta: expect.any(Number) }]]);

      const bumped = await knowledgeMethods.bumpKnowledgeCollectionStats('u-2', id, {
        documentDelta: 99,
        chunkDelta: 99,
      });
      expect(bumped).toBeNull();
      const stillAfter = await collectionOf(routes, id);
      expect(stillAfter.documentCount).toBe(before.documentCount);
      expect(stillAfter.chunkCount).toBe(before.chunkCount);
    });

    /**
     * The role on `req.user` is the only thing standing between a caller and a
     * global collection, and it reaches the service through the handler rather
     * than through anything the client controls. These are the boundary tests
     * for that path: `routes` builds the actor, `RagHandlers` forwards it, and
     * the service decides. A regression anywhere in the chain shows up here as
     * a 201 that should be a 403.
     */
    describe('the admin role reaches the service from req.user', () => {
      /**
       * The admin in the promoting/demoting cases owns the collection, so it is
       * a user who also happens to be an admin rather than a separate account.
       * Ownership is checked before scope, so a non-owner admin would get a 404
       * and the role would never be consulted.
       */
      const ADMIN_OWNER: RagUser = { id: 'u-1', role: SystemRoles.ADMIN };

      it.each([
        ['a plain user', 403, USER],
        ['a user with no role', 403, { id: 'u-1' } as RagUser],
        ['a request with no user at all', 403, undefined],
        ['an admin', 201, ADMIN],
      ])('answers %s creating a global collection with %i', async (_l, status, user) => {
        const { routes, knowledgeMethods } = setup();
        const response = createResponse();

        await routes.createCollection(
          createRequest({ body: { name: 'shared', scope: 'global' }, user }),
          response,
        );

        expect(statusOf(response)).toBe(status);
        if (status === 403) {
          expect(bodyOf(response)).toEqual({
            error: 'Collection scope not permitted: global requires the ADMIN role',
          });
          expect(knowledgeMethods.createKnowledgeCollection).not.toHaveBeenCalled();
        } else {
          expect(knowledgeMethods.createKnowledgeCollection).toHaveBeenCalledTimes(1);
        }
      });

      it.each([
        ['a plain user', 403, USER],
        ['a user with no role', 403, { id: 'u-1' } as RagUser],
        ['an admin who owns the collection', 200, ADMIN_OWNER],
      ])(
        'answers %s promoting a private collection to global with %i',
        async (_l, status, user) => {
          const { routes, knowledgeMethods } = setup();
          const id = await createOne(routes, 'u-1', { name: 'handbook', scope: 'private' });
          jest.mocked(knowledgeMethods.updateKnowledgeCollection).mockClear();
          const response = createResponse();

          await routes.updateCollection(
            createRequest({ body: { scope: 'global' }, user, params: { collectionId: id } }),
            response,
          );

          expect(statusOf(response)).toBe(status);
          if (status === 403) {
            expect(bodyOf(response)).toEqual({
              error: 'Collection scope not permitted: global requires the ADMIN role',
            });
            // The refusal happened before the write, not after.
            expect(knowledgeMethods.updateKnowledgeCollection).not.toHaveBeenCalled();
          } else {
            expect(knowledgeMethods.updateKnowledgeCollection).toHaveBeenCalledTimes(1);
          }
        },
      );

      it('answers 404, not 403, for a promotion attempt from a request with no user', async () => {
        // Not a missing case in the matrix above on purpose. An update resolves
        // the owner first, so a request with no `req.user` looks up the
        // collection as the empty owner and finds nothing. A 403 here would say
        // "this collection exists and you may not change its scope", which is
        // an existence oracle for collection ids; 404 gives the same refusal
        // without confirming anything. The create path needs no lookup, so it
        // can and does reach the 403 above.
        const { routes, knowledgeMethods } = setup();
        const id = await createOne(routes, 'u-1', { name: 'handbook', scope: 'private' });
        jest.mocked(knowledgeMethods.updateKnowledgeCollection).mockClear();
        const response = createResponse();

        await routes.updateCollection(
          createRequest({
            body: { scope: 'global' },
            user: undefined,
            params: { collectionId: id },
          }),
          response,
        );

        expect(statusOf(response)).toBe(404);
        expect(knowledgeMethods.updateKnowledgeCollection).not.toHaveBeenCalled();
      });

      it('lets a plain owner demote a global collection to private', async () => {
        // Only *sharing* needs the role. A plain owner taking their own global
        // collection back to private must not be refused, or a demotion would
        // need an admin and the rule would be broader than intended.
        const { routes, vectorStore } = setup();
        const id = await seedGlobal(routes, vectorStore);
        const response = createResponse();

        await routes.updateCollection(
          createRequest({
            body: { scope: 'private' },
            user: { id: 'admin-1', role: SystemRoles.USER },
            params: { collectionId: id },
          }),
          response,
        );

        expect(statusOf(response)).toBe(200);
      });

      it('does not let a client grant itself the role by putting one in the body', async () => {
        const { routes, knowledgeMethods } = setup();
        const response = createResponse();

        await routes.createCollection(
          createRequest({
            body: { name: 'shared', scope: 'global', role: SystemRoles.ADMIN } as never,
            user: USER,
          }),
          response,
        );

        expect(statusOf(response)).toBe(403);
        expect(knowledgeMethods.createKnowledgeCollection).not.toHaveBeenCalled();
      });
    });
  });

  describe('the disabled kill switch', () => {
    const ROUTE_CALLS: Array<
      [string, (routes: RagRoutes, config: AppConfig, response: Response) => Promise<unknown>]
    > = [
      [
        'createCollection',
        (routes, config, response) =>
          routes.createCollection(
            createRequest({
              body: { name: 'handbook' },
              user: { id: 'u-1' },
              params: {},
              config,
            }),
            response,
          ),
      ],
      [
        'listCollections',
        (routes, config, response) =>
          routes.listCollections(
            createRequest({ user: { id: 'u-1' }, params: {}, config }),
            response,
          ),
      ],
      [
        'getCollection',
        (routes, config, response) =>
          routes.getCollection(
            createRequest({ user: { id: 'u-1' }, params: { collectionId: 'c' }, config }),
            response,
          ),
      ],
      [
        'updateCollection',
        (routes, config, response) =>
          routes.updateCollection(
            createRequest({
              user: { id: 'u-1' },
              body: { name: 'x' },
              params: { collectionId: 'c' },
              config,
            }),
            response,
          ),
      ],
      [
        'deleteCollection',
        (routes, config, response) =>
          routes.deleteCollection(
            createRequest({ user: { id: 'u-1' }, params: { collectionId: 'c' }, config }),
            response,
          ),
      ],
      [
        'addDocument',
        (routes, config, response) =>
          routes.addDocument(
            createRequest({
              user: { id: 'u-1' },
              body: { content: 'text' },
              params: { collectionId: 'c' },
              config,
            }),
            response,
          ),
      ],
      [
        'deleteDocument',
        (routes, config, response) =>
          routes.deleteDocument(
            createRequest({
              user: { id: 'u-1' },
              params: { collectionId: 'c', documentId: 'd' },
              config,
            }),
            response,
          ),
      ],
      [
        'retrieve',
        (routes, config, response) =>
          routes.retrieve(
            createRequest({
              user: { id: 'u-1' },
              body: { query: 'rag' },
              params: { collectionId: 'c' },
              config,
            }),
            response,
          ),
      ],
    ];

    it.each(ROUTE_CALLS)('%s answers 503 with the kill-switch message', async (_n, call) => {
      const { routes, config } = setup({ disabled: true });
      const response = createResponse();

      await call(routes, config, response);

      expect(statusOf(response)).toBe(503);
      expect(bodyOf(response)).toEqual({ error: 'Knowledge retrieval is disabled' });
    });

    it.each(ROUTE_CALLS)('%s reaches the domain when the switch is off', async (_n, call) => {
      const { routes, config } = setup({ disabled: false });
      const response = createResponse();

      await call(routes, config, response);

      expect(statusOf(response)).not.toBe(503);
    });

    it('answers 201 from createCollection when the switch is off', async () => {
      const { routes, config } = setup({ disabled: false });
      const response = createResponse();

      await routes.createCollection(
        createRequest({ body: { name: 'handbook' }, user: { id: 'u-1' }, params: {}, config }),
        response,
      );

      expect(statusOf(response)).toBe(201);
    });

    it('answers 201 from addDocument when the switch is off', async () => {
      const { routes, config } = setup({ disabled: false });
      const id = await createOne(routes, 'u-1', { name: 'handbook' }, config);
      const response = createResponse();

      await routes.addDocument(
        createRequest({
          body: { content: 'the rag service chunks text' },
          user: { id: 'u-1' },
          params: { collectionId: id },
          config,
        }),
        response,
      );

      expect(statusOf(response)).toBe(201);
    });

    it('answers 200 from getCollection when the switch is off', async () => {
      const { routes, config } = setup({ disabled: false });
      const id = await createOne(routes, 'u-1', { name: 'handbook' }, config);
      const response = createResponse();

      await routes.getCollection(
        createRequest({ user: { id: 'u-1' }, params: { collectionId: id }, config }),
        response,
      );

      expect(statusOf(response)).toBe(200);
    });

    it('gates the route before validation, so a bad body still answers 503', async () => {
      const { routes, config } = setup({ disabled: true });
      const response = createResponse();

      await routes.createCollection(
        createRequest({ body: {}, user: { id: 'u-1' }, params: {}, config }),
        response,
      );

      expect(statusOf(response)).toBe(503);
    });

    it('gates the route before the domain call, so nothing is written', async () => {
      const { routes, knowledgeMethods, config } = setup({ disabled: true });
      const response = createResponse();

      await routes.createCollection(
        createRequest({ body: { name: 'handbook' }, user: { id: 'u-1' }, params: {}, config }),
        response,
      );

      expect(statusOf(response)).toBe(503);
      expect(knowledgeMethods.createKnowledgeCollection).not.toHaveBeenCalled();
    });

    it('treats a request with no config at all as disabled, not enabled', async () => {
      // `config: undefined` is stated rather than left out, because `createRequest`
      // supplies `ENABLED_CONFIG` and omitting the key would pass the enabled
      // config instead: this test used to be named "as enabled" and passed only
      // because of that default, so it stayed green through the inverse of the
      // behaviour it names. Nothing else in this file sends no config, so this is
      // the only thing pinning the no-config path.
      const { routes } = setup();
      const response = createResponse();

      await routes.createCollection(
        createRequest({
          body: { name: 'handbook' },
          user: { id: 'u-1' },
          params: {},
          config: undefined,
        }),
        response,
      );

      // A deployment that configured nothing gets `RAG_DEFAULTS`, and the
      // default is `disabled: true` — the feature is opt-in, so a request with
      // no `rag:` block is refused rather than served from a bare default.
      expect(statusOf(response)).toBe(503);
      expect(bodyOf(response)).toEqual({ error: 'Knowledge retrieval is disabled' });
    });

    it('re-enables a request whose own config object differs from the disabled one', async () => {
      const { routes } = setup();
      const enabled = { rag: { disabled: false } } as AppConfig;
      const disabled = { rag: { disabled: true } } as AppConfig;
      const blocked = createResponse();

      await routes.createCollection(
        createRequest({
          body: { name: 'blocked' },
          user: { id: 'u-1' },
          params: {},
          config: disabled,
        }),
        blocked,
      );
      expect(statusOf(blocked)).toBe(503);

      const allowed = createResponse();
      await routes.createCollection(
        createRequest({
          body: { name: 'allowed' },
          user: { id: 'u-1' },
          params: {},
          config: enabled,
        }),
        allowed,
      );
      expect(statusOf(allowed)).toBe(201);
    });
  });
});
