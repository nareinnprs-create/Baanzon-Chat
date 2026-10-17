const express = require('express');
const request = require('supertest');

/**
 * Integration tests for `api/server/routes/knowledge.js`.
 *
 * The real `@librechat/api` route factory runs here — `createRagRoutes`,
 * `InMemoryVectorStore` and `RAG_DEFAULTS` are the shipped implementations — so
 * these assertions exercise the domain's validation, status mapping and
 * retrieval through the actual Express wiring rather than a stand-in handler
 * that could only agree with itself. The durable collection methods from
 * `~/models` are replaced with an in-memory fake and the auth / config
 * middleware with controllable stand-ins, which is the same shape the app's own
 * wiring feeds the router, so what is under test is the route file plus the
 * real RAG domain behind it.
 */

/** Backing store for the `~/models` fake; `mock`-prefixed so `jest.mock` may close over it. */
const mockKnowledgeStore = {
  rows: new Map(),
  reset() {
    this.rows.clear();
  },
};

/** The caller `requireJwtAuth` stands in for, or the refusal it should give instead. */
let mockAuthUser = { id: 'user-1', role: 'USER' };
let mockAuthRejection = null;

/** The app config every request carries through `configMiddleware`. */
let mockAppConfig = {};

/** The middleware stand-ins themselves, so a test can assert they ran. */
const mockMiddleware = {};

jest.mock('~/server/middleware', () => {
  const requireJwtAuth = jest.fn((req, res, next) => {
    if (mockAuthRejection) {
      return res.status(mockAuthRejection.status).json({ error: mockAuthRejection.error });
    }
    req.user = mockAuthUser;
    return next();
  });
  const configMiddleware = jest.fn((req, _res, next) => {
    req.config = mockAppConfig;
    return next();
  });
  const pass = (_req, _res, next) => next();
  const createKnowledgeLimiters = jest.fn(() => ({
    knowledgeIpLimiter: pass,
    knowledgeUserLimiter: pass,
  }));
  mockMiddleware.requireJwtAuth = requireJwtAuth;
  mockMiddleware.configMiddleware = configMiddleware;
  mockMiddleware.createKnowledgeLimiters = createKnowledgeLimiters;
  return { requireJwtAuth, configMiddleware, createKnowledgeLimiters };
});

jest.mock('~/models', () => {
  const visible = (userId) =>
    [...mockKnowledgeStore.rows.values()].filter(
      (row) => row.userId === userId || row.scope === 'global',
    );

  return {
    createKnowledgeCollection: jest.fn(async (input) => {
      const now = new Date().toISOString();
      const row = {
        documentCount: 0,
        chunkCount: 0,
        createdAt: now,
        updatedAt: now,
        ...input,
      };
      mockKnowledgeStore.rows.set(row.id, row);
      return row;
    }),
    getKnowledgeCollection: jest.fn(async (userId, collectionId) => {
      const row = mockKnowledgeStore.rows.get(collectionId);
      if (row == null) {
        return null;
      }
      return row.userId === userId || row.scope === 'global' ? row : null;
    }),
    listKnowledgeCollections: jest.fn(async (userId) => visible(userId)),
    countKnowledgeCollections: jest.fn(async (userId) => visible(userId).length),
    updateKnowledgeCollection: jest.fn(async (userId, collectionId, patch) => {
      const row = mockKnowledgeStore.rows.get(collectionId);
      if (row == null || row.userId !== userId) {
        return null;
      }
      const next = { ...row, ...patch };
      mockKnowledgeStore.rows.set(collectionId, next);
      return next;
    }),
    bumpKnowledgeCollectionStats: jest.fn(async (userId, collectionId, delta) => {
      const row = mockKnowledgeStore.rows.get(collectionId);
      if (row == null || row.userId !== userId) {
        return null;
      }
      const next = {
        ...row,
        documentCount: row.documentCount + delta.documentDelta,
        chunkCount: row.chunkCount + delta.chunkDelta,
        updatedAt: new Date().toISOString(),
      };
      mockKnowledgeStore.rows.set(collectionId, next);
      return next;
    }),
    deleteKnowledgeCollection: jest.fn(async (userId, collectionId) => {
      const row = mockKnowledgeStore.rows.get(collectionId);
      if (row == null || row.userId !== userId) {
        return false;
      }
      mockKnowledgeStore.rows.delete(collectionId);
      return true;
    }),
  };
});

const knowledgeRouter = require('../knowledge');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/knowledge', knowledgeRouter);
  return app;
};

const MISSING_COLLECTION = '00000000-0000-0000-0000-000000000000';

describe('knowledge routes', () => {
  beforeEach(() => {
    // Retrieval is on by default (`RAG_DEFAULTS.disabled` is `false`), so an
    // explicit `rag.disabled: false` here only mirrors the resolved default; the
    // kill-switch test below is the one that turns it off.
    mockAppConfig = { rag: { disabled: false } };
    mockAuthUser = { id: 'user-1', role: 'USER' };
    mockAuthRejection = null;
    mockKnowledgeStore.reset();
  });

  describe('mount and route registration', () => {
    it('mounts at /api/knowledge and responds to GET /api/knowledge', async () => {
      const response = await request(buildApp()).get('/api/knowledge');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        collections: [],
        total: 0,
        hasMore: false,
        capacity: null,
      });
    });

    it('does not answer a path outside the /api/knowledge mount', async () => {
      const response = await request(buildApp()).get('/api/knowledges');

      expect(response.status).toBe(404);
    });

    it('registers only the documented methods on a collection', async () => {
      // `PUT` is not a registered verb, so the router falls through to Express's
      // 404 rather than reaching a handler that would have mutated the store.
      const response = await request(buildApp()).put('/api/knowledge/col-1');

      expect(response.status).toBe(404);
      expect(mockKnowledgeStore.rows.size).toBe(0);
    });
  });

  describe('authentication and config middleware', () => {
    it('applies requireJwtAuth before any knowledge route', async () => {
      mockAuthRejection = { status: 401, error: 'Unauthorized' };

      const response = await request(buildApp()).get('/api/knowledge');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
      expect(mockMiddleware.requireJwtAuth).toHaveBeenCalled();
    });

    it('blocks a mutating route too, so nothing is written for an unauthenticated caller', async () => {
      mockAuthRejection = { status: 401, error: 'Unauthorized' };

      const response = await request(buildApp()).post('/api/knowledge').send({ name: 'nope' });

      expect(response.status).toBe(401);
      expect(mockKnowledgeStore.rows.size).toBe(0);
    });

    it('passes the authenticated user through to the domain', async () => {
      mockAuthUser = { id: 'user-42', role: 'USER' };

      const response = await request(buildApp()).post('/api/knowledge').send({ name: 'mine' });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ userId: 'user-42', name: 'mine' });
    });

    it('runs configMiddleware and honors the rag.disabled kill switch', async () => {
      mockAppConfig = { rag: { disabled: true } };

      const response = await request(buildApp()).get('/api/knowledge');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: 'Knowledge retrieval is disabled' });
      expect(mockMiddleware.configMiddleware).toHaveBeenCalled();
    });

    it('serves requests by default when no rag block is configured', async () => {
      // No `rag` block at all: retrieval is on unless a deployment opts out.
      mockAppConfig = {};

      const response = await request(buildApp()).get('/api/knowledge');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ collections: [] });
    });
  });

  describe('success status mapping', () => {
    it('answers createCollection with 201 and the collection itself', async () => {
      const response = await request(buildApp())
        .post('/api/knowledge')
        .send({ name: 'test-collection' });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ name: 'test-collection', scope: 'private' });
      expect(response.body.id).toEqual(expect.any(String));
    });

    it('answers the full read/write lifecycle with the documented statuses', async () => {
      const created = await request(buildApp()).post('/api/knowledge').send({ name: 'handbook' });
      expect(created.status).toBe(201);
      const id = created.body.id;

      const listed = await request(buildApp()).get('/api/knowledge');
      expect(listed.status).toBe(200);
      expect(listed.body.total).toBe(1);

      const got = await request(buildApp()).get(`/api/knowledge/${id}`);
      expect(got.status).toBe(200);
      expect(got.body.collection.id).toBe(id);

      const patched = await request(buildApp())
        .patch(`/api/knowledge/${id}`)
        .send({ name: 'renamed' });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ updated: true, collection: { name: 'renamed' } });

      const added = await request(buildApp())
        .post(`/api/knowledge/${id}/documents`)
        .send({ content: 'the rag service chunks text into pieces', source: 'a.txt' });
      expect(added.status).toBe(201);
      const documentId = added.body.documentId;
      expect(documentId).toEqual(expect.any(String));

      const deletedDoc = await request(buildApp()).delete(
        `/api/knowledge/${id}/documents/${documentId}`,
      );
      expect(deletedDoc.status).toBe(200);
      expect(deletedDoc.body).toEqual({ deleted: true });

      const deleted = await request(buildApp()).delete(`/api/knowledge/${id}`);
      expect(deleted.status).toBe(200);
      expect(deleted.body).toEqual({ deleted: true });
    });
  });

  describe('validation errors', () => {
    it('answers 400 when a create has no name, writing nothing', async () => {
      const response = await request(buildApp()).post('/api/knowledge').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'name is required' });
      expect(mockKnowledgeStore.rows.size).toBe(0);
    });

    it('answers 400 when the create scope is unknown', async () => {
      const response = await request(buildApp())
        .post('/api/knowledge')
        .send({ name: 'handbook', scope: 'nope' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'scope must be one of: private, global' });
    });

    it('answers 400 when the create chunkSize is out of range', async () => {
      const response = await request(buildApp())
        .post('/api/knowledge')
        .send({ name: 'handbook', chunkSize: 0 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'chunkSize must be between 16 and 8000' });
    });

    it('answers 400 when a document has no content', async () => {
      const response = await request(buildApp()).post('/api/knowledge/col-1/documents').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'content is required' });
    });

    it('answers 400 when retrieve has no query', async () => {
      const response = await request(buildApp()).post('/api/knowledge/col-1/retrieve').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'query is required' });
    });

    it('answers 400 when a patch name is blank', async () => {
      const response = await request(buildApp())
        .patch('/api/knowledge/col-1')
        .send({ name: '   ' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'name must be 1..64 characters' });
    });

    it('answers 400 and names the field when a patch tries to change chunk geometry', async () => {
      const response = await request(buildApp())
        .patch('/api/knowledge/col-1')
        .send({ chunkSize: 64 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('chunkSize cannot be changed');
    });
  });

  describe('404 responses for a collection that does not exist', () => {
    it.each([
      ['getCollection', (app) => request(app).get(`/api/knowledge/${MISSING_COLLECTION}`)],
      [
        'updateCollection',
        (app) =>
          request(app).patch(`/api/knowledge/${MISSING_COLLECTION}`).send({ name: 'renamed' }),
      ],
      ['deleteCollection', (app) => request(app).delete(`/api/knowledge/${MISSING_COLLECTION}`)],
      [
        'addDocument',
        (app) =>
          request(app)
            .post(`/api/knowledge/${MISSING_COLLECTION}/documents`)
            .send({ content: 'text' }),
      ],
      [
        'deleteDocument',
        (app) => request(app).delete(`/api/knowledge/${MISSING_COLLECTION}/documents/doc-404`),
      ],
      [
        'retrieve',
        (app) =>
          request(app).post(`/api/knowledge/${MISSING_COLLECTION}/retrieve`).send({ query: 'rag' }),
      ],
    ])('%s answers 404 with a top-level error', async (_name, send) => {
      const response = await send(buildApp());

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: expect.any(String) });
    });

    it('names the missing collection on addDocument', async () => {
      const response = await request(buildApp())
        .post(`/api/knowledge/${MISSING_COLLECTION}/documents`)
        .send({ content: 'text' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Collection not found' });
    });
  });

  describe('retrieve results', () => {
    const createCollection = async (name) => {
      const response = await request(buildApp()).post('/api/knowledge').send({ name });
      expect(response.status).toBe(201);
      return response.body.id;
    };

    it('answers 200 with an empty snippets array when the collection has no documents', async () => {
      const id = await createCollection('empty');

      const response = await request(buildApp())
        .post(`/api/knowledge/${id}/retrieve`)
        .send({ query: 'anything at all' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ snippets: [] });
    });

    it('answers 200 with matching snippets once a document is ingested', async () => {
      const id = await createCollection('kb');
      await request(buildApp())
        .post(`/api/knowledge/${id}/documents`)
        .send({ content: 'the rag service chunks text into pieces' });

      const response = await request(buildApp())
        .post(`/api/knowledge/${id}/retrieve`)
        .send({ query: 'rag service chunks' });

      expect(response.status).toBe(200);
      expect(response.body.snippets.length).toBeGreaterThan(0);
      expect(response.body.snippets[0].text).toContain('rag service chunks');
    });
  });
});
