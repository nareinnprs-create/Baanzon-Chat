import type { VectorChunk } from './types';
import type { PgQueryExecutor } from './pgVectorStore';
import { createPgVectorStore, createSchemaSql } from './pgVectorStore';

/** Canned answer for the SQL fragment a test exercises; `[]` otherwise. */
function createExecutor(rowsFor: (text: string) => unknown[] = () => []): {
  executor: PgQueryExecutor;
  query: jest.Mock;
} {
  const query = jest.fn(async (text: string) => ({ rows: rowsFor(text) }));
  return { executor: { query } as unknown as PgQueryExecutor, query };
}

function chunk(documentId: string, chunkIndex: number, text: string): VectorChunk {
  return { collectionId: 'c-1', documentId, chunkIndex, text };
}

describe('createPgVectorStore', () => {
  describe('schema', () => {
    it('creates a vector column, a composite key and an index', () => {
      const sql = createSchemaSql('rag_vectors', 1536);

      expect(sql).toContain('vector(1536)');
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS rag_vectors/i);
      expect(sql).toMatch(/PRIMARY KEY \(collection_id, document_id, chunk_index\)/i);
      expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS rag_vectors_embedding_idx/i);
    });

    it('rejects a table name that is not a plain identifier', () => {
      expect(() => createSchemaSql('rag_vectors; DROP TABLE users', 4)).toThrow(/identifier/);
    });

    it('rejects a non-positive dimension', () => {
      expect(() => createSchemaSql('rag_vectors', 0)).toThrow(/dimensions/);
    });
  });

  describe('upsert', () => {
    it('issues an INSERT ... ON CONFLICT with the chunk as parameters', async () => {
      const { executor, query } = createExecutor();
      const store = createPgVectorStore({ query: executor });

      await store.upsertChunk('c-1', {
        collectionId: 'c-1',
        documentId: 'd-1',
        chunkIndex: 0,
        text: 'alpha',
        embedding: [0.1, 0.2],
        metadata: { source: 'x.txt' },
      });

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/INSERT INTO rag_vectors/i);
      expect(sql).toMatch(/ON CONFLICT \(collection_id, document_id, chunk_index\)/i);
      expect(sql).toMatch(/DO UPDATE SET/i);
      expect(params).toEqual([
        'c-1',
        'd-1',
        0,
        'alpha',
        '[0.1,0.2]',
        '{"source":"x.txt"}',
      ]);
    });

    it('stores a chunk without an embedding or metadata as NULL', async () => {
      const { executor, query } = createExecutor();
      const store = createPgVectorStore({ query: executor });

      await store.upsertChunk('c-1', chunk('d-1', 0, 'alpha'));

      expect(query.mock.calls[0][1]).toEqual(['c-1', 'd-1', 0, 'alpha', null, null]);
    });

    it('issues one INSERT per chunk and avoids work for an empty batch', async () => {
      const { executor, query } = createExecutor();
      const store = createPgVectorStore({ query: executor });

      await store.upsertChunks('c-1', []);
      expect(query).not.toHaveBeenCalled();

      await store.upsertChunks('c-1', [chunk('d-1', 0, 'alpha'), chunk('d-1', 1, 'beta')]);
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('rejects a chunk carrying an empty document id', async () => {
      const { executor } = createExecutor();
      const store = createPgVectorStore({ query: executor });

      await expect(store.upsertChunk('c-1', chunk('', 0, 'alpha'))).rejects.toThrow(/documentId/);
    });
  });

  describe('semanticSearch', () => {
    it('returns rows best-first with the limit bound as a parameter', async () => {
      const { executor, query } = createExecutor((sql) =>
        sql.includes('SELECT')
          ? [
              {
                collection_id: 'c-1',
                document_id: 'd-1',
                chunk_index: 0,
                text: 'alpha beta',
                embedding: '[1,2]',
                metadata: '{"k":"v"}',
              },
              {
                collection_id: 'c-1',
                document_id: 'd-2',
                chunk_index: 3,
                text: 'alpha',
                embedding: null,
                metadata: null,
              },
            ]
          : [],
      );
      const store = createPgVectorStore({ query: executor });

      const hits = await store.semanticSearch('c-1', 'alpha', 5);

      expect(hits.map((c) => `${c.documentId}:${c.chunkIndex}`)).toEqual(['d-1:0', 'd-2:3']);
      expect(hits[0].embedding).toEqual([1, 2]);
      expect(hits[0].metadata).toEqual({ k: 'v' });
      expect(hits[1].embedding).toBeUndefined();
      expect(hits[1].metadata).toBeUndefined();

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/ORDER BY/i);
      expect(sql).toMatch(/LIMIT \$3/i);
      expect(params).toEqual(['c-1', 'alpha', 5]);
    });

    it('returns an empty list when no row matches, without throwing', async () => {
      const { executor } = createExecutor();
      const store = createPgVectorStore({ query: executor });

      await expect(store.semanticSearch('c-1', 'nothing', 5)).resolves.toEqual([]);
    });

    it('short-circuits a non-positive limit', async () => {
      const { executor, query } = createExecutor();
      const store = createPgVectorStore({ query: executor });

      expect(await store.semanticSearch('c-1', 'alpha', 0)).toEqual([]);
      expect(query).not.toHaveBeenCalled();
    });

    it('rejects an empty collection id', async () => {
      const { executor } = createExecutor();
      const store = createPgVectorStore({ query: executor });

      await expect(store.semanticSearch('', 'alpha', 5)).rejects.toThrow(/collectionId/);
    });
  });

  describe('deleteDocument', () => {
    it('returns how many chunks the DELETE removed', async () => {
      const { executor, query } = createExecutor((sql) =>
        sql.includes('RETURNING') ? [{ chunk_index: 0 }, { chunk_index: 1 }] : [],
      );
      const store = createPgVectorStore({ query: executor });

      expect(await store.deleteDocument('c-1', 'd-1')).toBe(2);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/DELETE FROM rag_vectors/i);
      expect(sql).toMatch(/RETURNING/i);
      expect(params).toEqual(['c-1', 'd-1']);
    });

    it('returns 0 for a document it does not hold', async () => {
      const { executor } = createExecutor();
      const store = createPgVectorStore({ query: executor });

      expect(await store.deleteDocument('c-1', 'd-404')).toBe(0);
    });

    it('rejects an empty document id', async () => {
      const { executor } = createExecutor();
      const store = createPgVectorStore({ query: executor });

      await expect(store.deleteDocument('c-1', '')).rejects.toThrow(/documentId/);
    });
  });

  describe('deleteCollection', () => {
    it('deletes every row of the collection by parameter', async () => {
      const { executor, query } = createExecutor();
      const store = createPgVectorStore({ query: executor });

      await store.deleteCollection('c-1');

      expect(query).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM rag_vectors/i), ['c-1']);
    });
  });

  describe('countChunks', () => {
    it('maps COUNT(*) from the returned row', async () => {
      const { executor, query } = createExecutor((sql) =>
        sql.includes('COUNT(*)') ? [{ count: 7 }] : [],
      );
      const store = createPgVectorStore({ query: executor });

      expect(await store.countChunks('c-1')).toBe(7);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/COUNT\(\*\)/);
      expect(params).toEqual(['c-1']);
    });

    it('returns 0 when the collection has no rows', async () => {
      const { executor } = createExecutor();
      const store = createPgVectorStore({ query: executor });

      expect(await store.countChunks('c-1')).toBe(0);
    });
  });

  describe('capacity ceilings', () => {
    it('refuses a new chunk once the configured chunk ceiling is reached', async () => {
      const { executor } = createExecutor((sql) => {
        if (sql.includes('COUNT(*)') && sql.includes('JOIN')) {
          return [{ count: 0 }];
        }
        if (sql.includes('COUNT(*)')) {
          return [{ count: 2 }];
        }
        return [];
      });
      const store = createPgVectorStore({ query: executor, maxChunks: 2 });

      await expect(store.upsertChunk('c-1', chunk('d-1', 0, 'alpha'))).rejects.toThrow(
        /full \(2 chunks\)/,
      );
    });

    it('refuses a new collection once the configured collection ceiling is reached', async () => {
      const { executor } = createExecutor((sql) => {
        if (sql.includes('DISTINCT collection_id')) {
          return [{ count: 1 }];
        }
        return [];
      });
      const store = createPgVectorStore({ query: executor, maxCollections: 1 });

      await expect(store.upsertChunk('c-2', chunk('d-1', 0, 'alpha'))).rejects.toThrow(
        /full \(1 collections\)/,
      );
    });
  });
});
