/*
 * RAG domain entry point (blueprint B1.1).
 */
export { canAccessCollection, canWriteCollection, canUseScope } from './authorization';
export { chunkText } from './chunker';
export { RAG_API_URL, RAG_DEFAULTS, loadRagConfig, isRagApiConfigured, usesRagApi } from './config';
export type { RagDomainConfig } from './config';
export { createRagService } from './service';
export { createRagHandlers } from './handlers';
export type { RagHandlers } from './handlers';
export * from './types';
export {
  validateCreateCollection,
  validateAddDocument,
  validateRetrieve,
  validateCollectionPatch,
} from './validation';
export { InMemoryVectorStore } from './vectorStores';