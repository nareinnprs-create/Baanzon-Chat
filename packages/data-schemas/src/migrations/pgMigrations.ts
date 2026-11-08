import type { MigrationRunResult } from './ledger';
import { planMigrations } from './ledger';
import logger from '~/config/winston';

/**
 * Versioned migration ledger for PostgreSQL (NEXTROUND P7.1 + P7.2).
 *
 * The Mongo ledger in `ledger.ts` records into a collection; this sibling
 * records into its own `_baanzon_migrations` table, because a deployment's
 * pgvector schema and its Mongo ledger live in different databases and a
 * single ledger cannot span both. The runner mirrors the dependency
 * injection of `runMigrations`: the caller passes an injected
 * {@link PgQueryExecutor} — the same seam `packages/api`'s
 * `rag/pgVectorStore.ts` uses — and this module imports no driver.
 *
 * Concurrency: the ledger table's primary key on `id` is the guard. The
 * post-`up` insert runs `ON CONFLICT (id) DO NOTHING ... RETURNING id`; an
 * empty return means a concurrent runner recorded the row first, so the
 * entry is reported as `raced` instead of failing.
 */

/**
 * The only thing this module needs from a database client. Structurally
 * identical to `PgQueryExecutor` in `packages/api/src/rag/pgVectorStore.ts`
 * (which cannot be imported here: `packages/api` depends on this package),
 * so one `pg` Pool/Client satisfies both without a cast.
 */
export interface PgQueryExecutor {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** Ledger table name; overridable so two apps can share one database. */
export const DEFAULT_PG_LEDGER_TABLE = '_baanzon_migrations';

/** A table name is interpolated, not parameterized, so it must be an identifier. */
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdentifier(table: string): string {
  if (typeof table !== 'string' || !SQL_IDENTIFIER.test(table)) {
    throw new Error(
      `PgMigrations: ledger table must be a simple SQL identifier, received ${JSON.stringify(table)}`,
    );
  }
  return table;
}

export interface PgMigrationContext {
  /** The injected executor every statement runs through. */
  query: PgQueryExecutor;
  /** The ledger table this run records into. */
  ledgerTable: string;
}

export interface PgMigration {
  /** Monotonic version tag, e.g. `001-pgvector-schema`; runs in id order. */
  id: string;
  /** Human-readable purpose, stored on the ledger row for operators. */
  name: string;
  engine: 'pg';
  /** The migration body. Must be idempotent — a concurrent runner may race it. */
  up(context: PgMigrationContext): Promise<void>;
}

export interface RunPgMigrationsOptions {
  /** Injected database client (its own pooling is its concern). */
  query: PgQueryExecutor;
  migrations: PgMigration[];
  /** Ledger table name; defaults to {@link DEFAULT_PG_LEDGER_TABLE}. */
  ledgerTable?: string;
}

/**
 * Applies pending migrations in ascending id order, recording each applied id
 * in the ledger table. Idempotent and resumable exactly like `runMigrations`;
 * `MigrationRunResult` is shared so callers report both engines one way.
 */
export async function runPgMigrations(
  options: RunPgMigrationsOptions,
): Promise<MigrationRunResult> {
  const ledgerTable = assertIdentifier(options.ledgerTable ?? DEFAULT_PG_LEDGER_TABLE);
  const { queue, deferred } = planMigrations(options.migrations, 'pg');
  const result: MigrationRunResult = { applied: [], skipped: [], raced: [], deferred };

  await options.query.query(
    `CREATE TABLE IF NOT EXISTS ${ledgerTable} (
  id text PRIMARY KEY,
  name text NOT NULL,
  engine text,
  applied_at timestamptz NOT NULL DEFAULT now()
)`,
  );

  for (const migration of queue) {
    const { rows } = await options.query.query(
      `SELECT 1 AS present FROM ${ledgerTable} WHERE id = $1`,
      [migration.id],
    );
    if (rows.length > 0) {
      result.skipped.push(migration.id);
      continue;
    }
    await migration.up({ query: options.query, ledgerTable });
    const { rows: inserted } = await options.query.query(
      `INSERT INTO ${ledgerTable} (id, name, engine) VALUES ($1, $2, $3)
ON CONFLICT (id) DO NOTHING
RETURNING id`,
      [migration.id, migration.name, migration.engine],
    );
    if (inserted.length === 0) {
      result.raced.push(migration.id);
    } else {
      result.applied.push(migration.id);
    }
  }

  logger.info(
    `[PgMigrationLedger] ${ledgerTable}: ${result.applied.length} applied, ` +
      `${result.skipped.length} skipped, ${result.raced.length} raced, ` +
      `${result.deferred.length} deferred`,
  );
  return result;
}

export interface PgVectorMigrationOptions {
  /**
   * The DDL builder from the store side — `createSchemaSql` from
   * `packages/api/src/rag/pgVectorStore.ts`, injected rather than imported
   * because this package sits below `packages/api` in the dependency graph.
   * Injecting the builder (not its output) keeps table naming and dimension
   * validation in the one module that owns the store schema.
   */
  createSchemaSql: (table: string, dimensions: number) => string;
  /** Vectors table the DDL creates, e.g. `rag_vectors`. */
  table: string;
  /** Vector column width, e.g. 1536 for `text-embedding-3-small`. */
  dimensions: number;
  /** Version tag; defaults to `001-pgvector-schema`. */
  id?: string;
  /** Purpose; defaults to `pgvector schema`. */
  name?: string;
}

/**
 * The pgvector schema migration: one entry that applies `createSchemaSql`
 * through the runner's injected executor. `createSchemaSql` emits
 * `IF NOT EXISTS` throughout, so even a racing second application is a no-op.
 */
export function createPgVectorMigration(options: PgVectorMigrationOptions): PgMigration {
  const { createSchemaSql, table, dimensions } = options;
  return {
    id: options.id ?? '001-pgvector-schema',
    name: options.name ?? 'pgvector schema',
    engine: 'pg',
    async up(context: PgMigrationContext): Promise<void> {
      await context.query.query(createSchemaSql(table, dimensions));
    },
  };
}
