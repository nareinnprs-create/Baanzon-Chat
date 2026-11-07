const express = require('express');
const {
  createRagRoutes,
  createRagIntegration,
  InMemoryVectorStore,
  RAG_DEFAULTS,
} = require('@librechat/api');
const {
  requireJwtAuth,
  configMiddleware,
  createKnowledgeLimiters,
} = require('~/server/middleware');

const router = express.Router();
const { knowledgeIpLimiter, knowledgeUserLimiter } = createKnowledgeLimiters();

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

/**
 * The semantic half is a boot-time integration, resolved from the environment
 * once — the route factory takes its collaborators at construction, so a
 * provider cannot be rebuilt per request. Unset, the domain ingests and
 * retrieves keyword-only, which is the guaranteed fallback.
 */
const { embedder, semantic } = createRagIntegration({ vectorStore });

const routes = createRagRoutes({
  knowledgeMethods,
  vectorStore,
  ...(semantic ? { semantic } : {}),
  ...(embedder ? { embedder } : {}),
});

/** Auth first (the user limiter keys on the resolved user), then both windows. */
router.use(requireJwtAuth, knowledgeIpLimiter, knowledgeUserLimiter);

router.get('/', configMiddleware, routes.listCollections);
router.post('/', configMiddleware, routes.createCollection);

router.get('/:collectionId', configMiddleware, routes.getCollection);
router.patch('/:collectionId', configMiddleware, routes.updateCollection);
router.delete('/:collectionId', configMiddleware, routes.deleteCollection);

router.post('/:collectionId/documents', configMiddleware, routes.addDocument);
router.delete('/:collectionId/documents/:documentId', configMiddleware, routes.deleteDocument);

router.post('/:collectionId/retrieve', configMiddleware, routes.retrieve);

module.exports = router;
