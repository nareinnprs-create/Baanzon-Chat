/**
 * Durable PostgreSQL/pgvector `VectorStore` (ruling A4 / NEXTROUND P1.6).
 *
 * The process-scoped `InMemoryVectorStore` starts empty on every restart, so
 * the vectors a collection's durable ledger still counts are gone once the
 * process dies. This store keeps them in a table instead, keyed by
 * `(collection_id, document_id, chunk_index)`, and reuses the same
 * {@link VectorStore} contract so a deployment swaps a constructor argument
 * rather than a code path.
 *
 * The seam is the injected {@link PgQueryExecutor}: this module imports no
 * driver, no logger, no HTTP and no data-schemas method. It calls `.query` with
 * parameterized SQL and reads `.rows`, which is exactly the shape `pg`'s
 * `Pool`/`Client` already expose — so the deployment passes its own pooled
 * client and this module never learns which driver that is.
 *
 * Schema creation is deliberately not performed here. {@link createSchemaSql}
 * returns the DDL as a string for a migration to run; a store that issued DDL
 * on construction would make every reader a writer and every typo a silent
 * table change.
 */
import type { VectorChunk, VectorStore } from './types';

/**
 * The only thing this module needs from a database client.
 *
 * Structural, not nominal, so `pg`'s `Pool`/`Client` satisfies it without a
 * cast and without this package depending on `pg`. `query` is generic so a
 * caller reads `.rows` as the row type it expects.
 */
export interface PgQueryExecutor {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface PgVectorStoreOptions {
  /** Injected database client (its own pooling is its concern). */
  query: PgQueryExecutor;
  /** Table holding the chunks. Defaults to `rag_vectors`. */
  table?: string;
  /**
   * Vector width used by {@link createSchemaSql}. Validated when supplied, and
   * *not* enforced per row: the column's `vector(n)` typmod already rejects a
   * mismatched vector, and checking a default width here would reject a
   * deployment whose table was created at another width.
   */
  dimensions?: number;
  /** Refuse writes once the table holds this many chunks; 0 = unbounded. */
  maxChunks?: number;
  /** Refuse writes once the table spans this many collections; 0 = unbounded. */
  maxCollections?: number;
}

/** Default table name; overridable so two stores can share one database. */
export const DEFAULT_PG_VECTOR_TABLE = 'rag_vectors';

/** Default vector width, matching the OpenAI `text-embedding-3-small` family. */
export const DEFAULT_PG_VECTOR_DIMENSIONS = 1536;

/** A table name is interpolated, not parameterized, so it must be an identifier. */
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** One `SELECT`ed row, in the table's column casing. */
interface PgVectorRow {
  collection_id: string;
  document_id: string;
  chunk_index: number;
  text: string;
  embedding?: unknown;
  metadata?: unknown;
}

function assertIdentifier(table: string): string {
  if (typeof table !== 'string' || !SQL_IDENTIFIER.test(table)) {
    throw new Error(
      `PgVectorStore: table must be a simple SQL identifier, received ${JSON.stringify(table)}`,
    );
  }
  return table;
}

function assertDimensions(dimensions: number): number {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(
      `PgVectorStore: dimensions must be a positive integer, received ${String(dimensions)}`,
    );
  }
  return dimensions;
}

/** A configured ceiling that is absent, non-numeric or non-positive is unbounded. */
function ceiling(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function assertId(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`PgVectorStore: ${name} must be a non-empty string`);
  }
}

/** pgvector's text input format; an absent or empty vector stores as NULL. */
function toVectorLiteral(embedding: number[] | undefined): string | null {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return null;
  }
  return `[${embedding.join(',')}]`;
}

function toJsonLiteral(metadata: Record<string, unknown> | undefined): string | null {
  return metadata == null ? null : JSON.stringify(metadata);
}

function toCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** pgvector returns whatever the driver decoded: an array, or its text form. */
function toEmbedding(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value as number[];
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as number[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toMetadata(value: unknown): Record<string, unknown> {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* fall through to an empty object */
    }
  }
  return {};
}

function toChunk(row: PgVectorRow): VectorChunk {
  return {
    collectionId: row.collection_id,
    documentId: row.document_id,
    chunkIndex: row.chunk_index,
    text: row.text,
    ...(row.embedding != null ? { embedding: toEmbedding(row.embedding) } : {}),
    ...(row.metadata != null ? { metadata: toMetadata(row.metadata) } : {}),
  };
}

/**
 * The DDL a migration runs, as a string.
 *
 * `vector(<dimensions>)` fixes the column width, the composite primary key is
 * what makes `ON CONFLICT` an upsert, and the HNSW index serves a future
 * cosine-distance ordering the same way the b-tree serves the collection
 * filter. `IF NOT EXISTS` everywhere so re-running is safe.
 */
export function createSchemaSql(table: string, dimensions: number): string {
  const name = assertIdentifier(table);
  const width = assertDimensions(dimensions);
  return [
    'CREATE EXTENSION IF NOT EXISTS vector;',
    `CREATE TABLE IF NOT EXISTS ${name} (`,
    '  collection_id text NOT NULL,',
    '  document_id text NOT NULL,',
    '  chunk_index integer NOT NULL,',
    '  text text NOT NULL,',
    `  embedding vector(${width}),`,
    '  metadata jsonb,',
    '  PRIMARY KEY (collection_id, document_id, chunk_index)',
    ');',
    `CREATE INDEX IF NOT EXISTS ${name}_embedding_idx ON ${name} USING hnsw (embedding vector_cosine_ops);`,
    `CREATE INDEX IF NOT EXISTS ${name}_collection_idx ON ${name} (collection_id);`,
  ].join('\n');
}

/**
 * Build a durable store over an injected executor.
 *
 * `semanticSearch` mirrors `InMemoryVectorStore`: best-first by lexical overlap,
 * capped at `limit`, and never throwing on an empty result. It is expressed as
 * PostgreSQL full-text ranking rather than in JS because the corpus is not in
 * this process; an `ILIKE` disjunct keeps substring and stop-word-only queries
 * (which `tsvector` discards) matching the way the in-memory tokenizer would.
 */
export function createPgVectorStore(options: PgVectorStoreOptions): VectorStore {
  const query = options.query;
  const table = assertIdentifier(options.table ?? DEFAULT_PG_VECTOR_TABLE);
  assertDimensions(options.dimensions ?? DEFAULT_PG_VECTOR_DIMENSIONS);
  const maxChunks = ceiling(options.maxChunks);
  const maxCollections = ceiling(options.maxCollections);

  const insertSql = `INSERT INTO ${table} (collection_id, document_id, chunk_index, text, embedding, metadata)
VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb)
ON CONFLICT (collection_id, document_id, chunk_index)
DO UPDATE SET text = EXCLUDED.text, embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata`;

  const searchSql = `SELECT collection_id, document_id, chunk_index, text, embedding, metadata
FROM ${table}
WHERE collection_id = $1
  AND (
    to_tsvector('english', text) @@ websearch_to_tsquery('english', $2)
    OR text ILIKE '%' || $2 || '%'
  )
ORDER BY ts_rank(to_tsvector('english', text), websearch_to_tsquery('english', $2)) DESC,
         document_id ASC, chunk_index ASC
LIMIT $3`;

  async function countAllChunks(): Promise<number> {
    const { rows } = await query.query<{ count: number | string }>(
      `SELECT COUNT(*)::int AS count FROM ${table}`,
    );
    return toCount(rows[0]?.count);
  }

  async function countAllCollections(): Promise<number> {
    const { rows } = await query.query<{ count: number | string }>(
      `SELECT COUNT(DISTINCT collection_id)::int AS count FROM ${table}`,
    );
    return toCount(rows[0]?.count);
  }

  async function collectionExists(collectionId: string): Promise<boolean> {
    const { rows } = await query.query(
      `SELECT 1 AS present FROM ${table} WHERE collection_id = $1 LIMIT 1`,
      [collectionId],
    );
    return rows.length > 0;
  }

  /**
   * How many of `chunks` already sit at their `(document_id, chunk_index)`.
   * Paired by `unnest`, not by two `= ANY`s, so the count cannot pair a
   * document id with another chunk's index and overstate what exists.
   */
  async function countExisting(collectionId: string, chunks: VectorChunk[]): Promise<number> {
    const documentIds = chunks.map((chunk) => chunk.documentId);
    const chunkIndexes = chunks.map((chunk) => chunk.chunkIndex);
    const { rows } = await query.query<{ count: number | string }>(
      `SELECT COUNT(*)::int AS count
FROM ${table} AS t
JOIN unnest($2::text[], $3::int[]) AS incoming(document_id, chunk_index)
  ON incoming.document_id = t.document_id AND incoming.chunk_index = t.chunk_index
WHERE t.collection_id = $1`,
      [collectionId, documentIds, chunkIndexes],
    );
    return toCount(rows[0]?.count);
  }

  /**
   * A configured ceiling is checked at write time. This is the one signal a
   * database-backed store can honestly give: `capacity()` is synchronous and
   * this process cannot count rows another replica wrote, so reporting a
   * remaining figure would invent one. A re-upsert of an existing chunk is not
   * new and does not consume the budget.
   */
  async function assertCapacity(collectionId: string, chunks: VectorChunk[]): Promise<void> {
    if (maxCollections > 0 && !(await collectionExists(collectionId))) {
      const used = await countAllCollections();
      if (used >= maxCollections) {
        throw new Error(`PgVectorStore is full (${maxCollections} collections)`);
      }
    }
    if (maxChunks > 0) {
      const total = await countAllChunks();
      const existing = await countExisting(collectionId, chunks);
      const added = Math.max(0, chunks.length - existing);
      if (total + added > maxChunks) {
        throw new Error(`PgVectorStore is full (${maxChunks} chunks)`);
      }
    }
  }

  async function upsertChunks(collectionId: string, chunks: VectorChunk[]): Promise<void> {
    assertId(collectionId, 'collectionId');
    if (chunks.length === 0) {
      return;
    }
    for (const chunk of chunks) {
      assertId(chunk.documentId, 'documentId');
      if (!Number.isInteger(chunk.chunkIndex) || chunk.chunkIndex < 0) {
        throw new Error(
          `PgVectorStore: chunkIndex must be a non-negative integer, received ${String(
            chunk.chunkIndex,
          )}`,
        );
      }
    }
    if (maxChunks > 0 || maxCollections > 0) {
      await assertCapacity(collectionId, chunks);
    }
    for (const chunk of chunks) {
      await query.query(insertSql, [
        collectionId,
        chunk.documentId,
        chunk.chunkIndex,
        chunk.text,
        toVectorLiteral(chunk.embedding),
        toJsonLiteral(chunk.metadata),
      ]);
    }
  }

  return {
    async upsertChunk(collectionId: string, chunk: VectorChunk): Promise<void> {
      await upsertChunks(collectionId, [chunk]);
    },

    upsertChunks,

    async semanticSearch(collectionId: string, searchQuery: string, limit: number): Promise<VectorChunk[]> {
      assertId(collectionId, 'collectionId');
      if (typeof searchQuery !== 'string') {
        throw new Error('PgVectorStore: query must be a string');
      }
      const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
      if (safeLimit === 0) {
        return [];
      }
      const { rows } = await query.query<PgVectorRow>(searchSql, [
        collectionId,
        searchQuery,
        safeLimit,
      ]);
      return rows.map(toChunk);
    },

    async deleteDocument(collectionId: string, documentId: string): Promise<number> {
      assertId(collectionId, 'collectionId');
      assertId(documentId, 'documentId');
      const { rows } = await query.query(
        `DELETE FROM ${table} WHERE collection_id = $1 AND document_id = $2 RETURNING chunk_index`,
        [collectionId, documentId],
      );
      return rows.length;
    },

    async deleteCollection(collectionId: string): Promise<void> {
      assertId(collectionId, 'collectionId');
      await query.query(`DELETE FROM ${table} WHERE collection_id = $1`, [collectionId]);
    },

    async countChunks(collectionId: string): Promise<number> {
      assertId(collectionId, 'collectionId');
      const { rows } = await query.query<{ count: number | string }>(
        `SELECT COUNT(*)::int AS count FROM ${table} WHERE collection_id = $1`,
        [collectionId],
      );
      return toCount(rows[0]?.count);
    },
  };
}
