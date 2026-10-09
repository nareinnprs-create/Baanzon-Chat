const express = require('express');
const { createRagRoutes, InMemoryVectorStore, RAG_DEFAULTS } = require('@librechat/api');
const { requireJwtAuth, configMiddleware } = require('~/server/middleware');

const router = express.Router();

/**
 * Knowledge bases and retrieval (blueprint §24, §45).
 *
 * Durable collection metadata comes from the `KnowledgeCollection` model; the
 * RAG service, its validation and its status mapping live in `@librechat/api`,
 * so this file only builds the runtime and registers routes. Retrieval tuning is
 * read from `req.config.rag` per request, set in `baanzon.yaml`.
 */
const knowledgeMethods = require('~/models');

/**
 * The index is process-scoped, so it is built once here rather than per request
 * — a per-request store would give every user a private copy of the vectors.
 * Limits from `req.config.rag` are applied to it as config resolves.
 */
const vectorStore = new InMemoryVectorStore({
  maxCollections: RAG_DEFAULTS.inMemoryMaxCollections,
  maxChunks: RAG_DEFAULTS.inMemoryMaxChunks,
});

const routes = createRagRoutes({ knowledgeMethods, vectorStore });

router.use(requireJwtAuth);

router.get('/', configMiddleware, routes.listCollections);
router.post('/', configMiddleware, routes.createCollection);

router.get('/:collectionId', configMiddleware, routes.getCollection);
router.patch('/:collectionId', configMiddleware, routes.updateCollection);
router.delete('/:collectionId', configMiddleware, routes.deleteCollection);

router.post('/:collectionId/documents', configMiddleware, routes.addDocument);
router.delete('/:collectionId/documents/:documentId', configMiddleware, routes.deleteDocument);

router.post('/:collectionId/retrieve', configMiddleware, routes.retrieve);

module.exports = router;
