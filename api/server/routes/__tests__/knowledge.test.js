const express = require('express');
const request = require('supertest');

const mockRagHandlers = {
  createCollection: jest.fn(),
  listCollections: jest.fn(),
  getCollection: jest.fn(),
  updateCollection: jest.fn(),
  deleteCollection: jest.fn(),
  addDocument: jest.fn(),
  deleteDocument: jest.fn(),
  retrieve: jest.fn(),
};

let mockAppConfig = {};

jest.mock('@librechat/api', () => ({
  createRagRoutes: jest.fn(() => mockRagHandlers),
  InMemoryVectorStore: jest.fn().mockImplementation(() => ({})),
  RAG_DEFAULTS: {
    inMemoryMaxCollections: 100,
    inMemoryMaxChunks: 10000,
  },
}));

jest.mock('~/models', () => ({
  getKnowledgeCollections: jest.fn(),
  getKnowledgeCollection: jest.fn(),
  listKnowledgeCollections: jest.fn(),
  updateKnowledgeCollection: jest.fn(),
  deleteKnowledgeCollection: jest.fn(),
  bumpKnowledgeCollectionStats: jest.fn(),
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, _res, next) => {
    req.user = { id: 'user-1', role: 'USER' };
    next();
  },
  configMiddleware: (req, _res, next) => {
    req.config = mockAppConfig;
    next();
  },
}));

const knowledgeRouter = require('../knowledge');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/knowledge', knowledgeRouter);
  return app;
};

describe('knowledge routes', () => {
  beforeEach(() => {
    mockAppConfig = {};
    jest.clearAllMocks();

    mockRagHandlers.createCollection.mockImplementation(async (_req, res) => {
      res.status(201).json({ id: 'col-1' });
    });
    mockRagHandlers.listCollections.mockImplementation(async (_req, res) => {
      res.status(200).json({ collections: [], total: 0 });
    });
    mockRagHandlers.getCollection.mockImplementation(async (_req, res) => {
      res.status(200).json({ collection: { id: 'col-1' } });
    });
    mockRagHandlers.updateCollection.mockImplementation(async (_req, res) => {
      res.status(200).json({ id: 'col-1' });
    });
    mockRagHandlers.deleteCollection.mockImplementation(async (_req, res) => {
      res.status(200).json({ deleted: true });
    });
    mockRagHandlers.addDocument.mockImplementation(async (_req, res) => {
      res.status(201).json({ documentId: 'doc-1' });
    });
    mockRagHandlers.deleteDocument.mockImplementation(async (_req, res) => {
      res.status(200).json({ deleted: true });
    });
    mockRagHandlers.retrieve.mockImplementation(async (_req, res) => {
      res.status(200).json({ snippets: [] });
    });
  });

  it('mounts at /api/knowledge and responds to GET /api/knowledge', async () => {
    const response = await request(buildApp()).get('/api/knowledge');
    expect(response.status).toBe(200);
  });

  it('POST /api/knowledge creates a collection', async () => {
    const response = await request(buildApp())
      .post('/api/knowledge')
      .send({ name: 'test-collection' });
    expect(response.status).toBe(201);
  });

  it('GET /api/knowledge/:collectionId retrieves a collection', async () => {
    const response = await request(buildApp()).get('/api/knowledge/col-1');
    expect(response.status).toBe(200);
  });

  it('PATCH /api/knowledge/:collectionId updates a collection', async () => {
    const response = await request(buildApp())
      .patch('/api/knowledge/col-1')
      .send({ name: 'updated' });
    expect(response.status).toBe(200);
  });

  it('DELETE /api/knowledge/:collectionId deletes a collection', async () => {
    const response = await request(buildApp()).delete('/api/knowledge/col-1');
    expect(response.status).toBe(200);
  });

  it('POST /api/knowledge/:collectionId/documents adds a document', async () => {
    const response = await request(buildApp())
      .post('/api/knowledge/col-1/documents')
      .send({ content: 'test content' });
    expect(response.status).toBe(201);
  });

  it('DELETE /api/knowledge/:collectionId/documents/:documentId deletes a document', async () => {
    const response = await request(buildApp()).delete('/api/knowledge/col-1/documents/doc-1');
    expect(response.status).toBe(200);
  });

  it('POST /api/knowledge/:collectionId/retrieve retrieves snippets', async () => {
    const response = await request(buildApp())
      .post('/api/knowledge/col-1/retrieve')
      .send({ query: 'test' });
    expect(response.status).toBe(200);
  });
});
