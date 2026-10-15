import {
  createRagIntegration,
  RAG_EMBEDDING_API_URL,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DIMENSION,
} from './wiring';
import type { VectorStore } from './types';

/** The only method the semantic client reaches for. */
const vectorStore = {
  semanticSearch: jest.fn(async () => []),
} as unknown as VectorStore;

describe('createRagIntegration', () => {
  it('returns nothing when no embeddings endpoint is configured', () => {
    expect(createRagIntegration({ vectorStore, env: {} })).toEqual({});
  });

  it('treats a blank endpoint as unconfigured', () => {
    expect(createRagIntegration({ vectorStore, env: { [RAG_EMBEDDING_API_URL]: '   ' } })).toEqual(
      {},
    );
  });

  it('builds both the ingest embedder and the semantic client when configured', () => {
    const integration = createRagIntegration({
      vectorStore,
      env: { [RAG_EMBEDDING_API_URL]: 'https://provider.example/v1' },
    });

    expect(integration.embedder).toBeDefined();
    expect(typeof integration.embedder?.embed).toBe('function');
    expect(integration.semantic).toBeDefined();
    expect(typeof integration.semantic?.search).toBe('function');
  });

  it('defaults the model and dimension, and tolerates a missing api key', async () => {
    const integration = createRagIntegration({
      vectorStore,
      env: { [RAG_EMBEDDING_API_URL]: 'https://provider.example/v1' },
    });
    // The query embedder carries the resolved dimension; the defaults are used
    // because neither RAG_EMBEDDING_MODEL nor RAG_EMBEDDING_DIMENSION is set.
    expect(DEFAULT_EMBEDDING_MODEL).toBe('text-embedding-3-small');
    expect(DEFAULT_EMBEDDING_DIMENSION).toBe(1536);
    await expect(integration.embedder?.embed([])).resolves.toEqual([]);
  });
});
