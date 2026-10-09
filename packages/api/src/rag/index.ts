/*
 * RAG domain entry point (blueprint B1.1).
 */
export { canAccessCollection, canWriteCollection, canUseScope } from './authorization';
export { RagError, badRequest, forbidden, notFound } from './errors';
export type { RagErrorStatus } from './errors';
export { chunkText } from './chunker';
export { RAG_API_URL, RAG_DEFAULTS, loadRagConfig, isRagApiConfigured, usesRagApi } from './config';
export type { RagDomainConfig } from './config';
export { createRagService } from './service';
export type { RagService, RagServiceDeps, SnippetReranker, AddDocumentResult } from './service';
export { createRagHandlers } from './handlers';
export type { RagHandlers } from './handlers';
export { createMongoKnowledgeStore } from './knowledgeStore';
export type { MongoKnowledgeStoreDeps } from './knowledgeStore';
export { createRagRoutes } from './routes';
export type { RagRoutes } from './routes';
export { createRagRuntime, resolveRagConfig } from './runtime';
export type { RagRuntime, RagRuntimeConfig, RagRuntimeDeps } from './runtime';
export * from './types';
export {
  validateCreateCollection,
  validateAddDocument,
  validateRetrieve,
  validateCollectionPatch,
} from './validation';
export { InMemoryVectorStore } from './vectorStores';
export type { InMemoryVectorStoreOptions } from './vectorStores';

export { createSemanticSearchService, cosineSimilarity } from './semanticSearch';
export type {
  SemanticSearchService,
  SemanticSearchDeps,
  Reranker,
  EmbeddingsProvider,
} from './semanticSearch';

export { embedChunks, EMBED_REMEDY } from './embeddings';
export type {
  ChunkEmbedder,
  EmbedChunksResult,
  EmbeddingReport,
  EmbedDegradation,
} from './embeddings';
