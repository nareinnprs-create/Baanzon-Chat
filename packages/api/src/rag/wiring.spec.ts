import type { PgQueryExecutor } from './pgVectorStore';
import type { VectorStore } from './types';
import {
  createRagIntegration,
  initializeRagVectorStore,
  RAG_EMBEDDING_API_URL,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DIMENSION,
} from './wiring';
import { InMemoryVectorStore } from './vectorStores';
import * as semanticSearch from './semanticSearch';
import { RAG_DEFAULTS } from './config';

/** The only method the semantic client reaches for. */
const vectorStore = {
  semanticSearch: jest.fn(async () => []),
} as unknown as VectorStore;

/** The durable store pg mode must have injected. */
const pgVectorStore = {
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

/** Retrieval tuning, spelled out so the mode tests only vary the mode. */
const retrieval = { candidateK: 32, topK: 6, minScore: 0.1 };

describe('createRagIntegration vector store mode', () => {
  it("defaults to inMemory and scores against the caller's store", () => {
    const spy = jest.spyOn(semanticSearch, 'createSemanticSearchService');

    const integration = createRagIntegration({
      vectorStore,
      env: { [RAG_EMBEDDING_API_URL]: 'https://provider.example/v1' },
    });

    expect(integration.semantic).toBeDefined();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ vectorStore }));
  });

  it('throws in pg mode without an injected store instead of falling back', () => {
    // Even with no embeddings endpoint configured — where the function would
    // otherwise return `{}` — a pg deployment missing its store must fail the
    // build rather than come up keyword-only over the wrong store.
    expect(() =>
      createRagIntegration({
        vectorStore,
        config: { ...retrieval, vectorStore: 'pg' },
        env: {},
      }),
    ).toThrow(/pgVectorStore/);
  });

  it('scores against the injected durable store in pg mode', () => {
    const spy = jest.spyOn(semanticSearch, 'createSemanticSearchService');

    const integration = createRagIntegration({
      vectorStore,
      pgVectorStore,
      config: { ...retrieval, vectorStore: 'pg' },
      env: { [RAG_EMBEDDING_API_URL]: 'https://provider.example/v1' },
    });

    expect(integration.embedder).toBeDefined();
    expect(integration.semantic).toBeDefined();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ vectorStore: pgVectorStore }));
  });
});

/** Ledger-aware fake of the statements `runPgMigrations` and the DDL issue. */
function createFakePgExecutor(): { executor: PgQueryExecutor; statements: string[] } {
  const statements: string[] = [];
  const applied = new Set<string>();
  async function query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
    statements.push(text);
    if (text.includes('CREATE TABLE IF NOT EXISTS')) {
      return { rows: [] };
    }
    if (text.startsWith('SELECT 1 AS present')) {
      return { rows: (applied.has(String(params?.[0])) ? [{ present: 1 }] : []) as T[] };
    }
    if (text.includes('ON CONFLICT (id) DO NOTHING')) {
      const id = String(params?.[0]);
      if (applied.has(id)) {
        return { rows: [] as T[] };
      }
      applied.add(id);
      return { rows: [{ id }] as T[] };
    }
    return { rows: [] as T[] };
  }
  return { executor: { query }, statements };
}

describe('initializeRagVectorStore', () => {
  const inMemoryConfig = {
    vectorStore: 'inMemory' as const,
    inMemoryMaxCollections: RAG_DEFAULTS.inMemoryMaxCollections,
    inMemoryMaxChunks: RAG_DEFAULTS.inMemoryMaxChunks,
  };

  it('returns the in-memory store and is side-effect-free when mode is inMemory', async () => {
    const { executor, statements } = createFakePgExecutor();

    const store = await initializeRagVectorStore({
      config: inMemoryConfig,
      pgQuery: executor,
    });

    expect(store).toBeInstanceOf(InMemoryVectorStore);
    expect(statements).toHaveLength(0);
  });

  it('throws in pg mode when no executor is injected', async () => {
    await expect(
      initializeRagVectorStore({
        config: { ...inMemoryConfig, vectorStore: 'pg' },
      }),
    ).rejects.toThrow(/pgQuery/);
  });

  it('runs the pgvector migration once, then returns the durable store', async () => {
    const { executor, statements } = createFakePgExecutor();
    const config = { ...inMemoryConfig, vectorStore: 'pg' as const };

    const store = await initializeRagVectorStore({ config, pgQuery: executor });
    const schemaRuns = statements.filter((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS rag_vectors'),
    );
    expect(schemaRuns).toHaveLength(1);
    expect(schemaRuns[0]).toContain('vector(1536)');
    expect(statements[0]).toMatch(/_baanzon_migrations/);
    expect(typeof store.semanticSearch).toBe('function');

    await initializeRagVectorStore({ config, pgQuery: executor });
    expect(
      statements.filter((sql) => sql.includes('CREATE TABLE IF NOT EXISTS rag_vectors')),
    ).toHaveLength(1);
  });
});
