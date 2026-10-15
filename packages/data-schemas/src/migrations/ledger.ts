import { buildIndexWithRetry } from '~/utils/retry';
import logger from '~/config/winston';

/**
 * Versioned migration ledger for MongoDB (NEXTROUND P7.2).
 *
 * `runMigrations` applies a monotonic list of migrations exactly once per
 * deployment: every applied id is recorded in a ledger collection, so a
 * rerun skips what a previous run (or a peer replica booting the same
 * release) already applied. The framework takes its storage handle from the
 * caller — a mongoose `Connection`, a registered ledger `Model`, or the raw
 * driver collection — and imports no app singleton, the same dependency
 * direction as `createModels(mongoose)` and `migrateTenantIndexes(connection)`.
 *
 * Concurrency: the ledger carries a unique index on `id`. Two runners racing
 * the same migration both execute `up` (the read cannot lock), but only one
 * insert wins; the loser's duplicate-key error is swallowed and the migration
 * is reported as `raced` rather than failing the boot. Because `up` may then
 * have run twice, a migration's `up` must be idempotent — which every
 * `IF NOT EXISTS`-style schema change already is.
 */

/** Ledger collection name; overridable so two apps can share one database. */
export const DEFAULT_MIGRATION_LEDGER_NAME = '_baanzon_migrations';

/** Mongo's duplicate-key code: the unique-index race lost, not an error. */
const DUPLICATE_KEY_CODE = 11000;

export type MigrationEngine = 'mongo' | 'pg';

export interface Migration {
  /**
   * Monotonic version tag, e.g. `001-init`. Migrations run in ascending id
   * order regardless of array order, so a ledger row doubles as the version.
   */
  id: string;
  /** Human-readable purpose, stored on the ledger row for operators. */
  name: string;
  /**
   * When set, only the runner for that engine executes the migration; a
   * shared list can carry both Mongo and pg entries and each runner defers
   * the other's instead of running them against the wrong engine.
   */
  engine?: MigrationEngine;
  /** The migration body. Must be idempotent — a concurrent runner may race it. */
  up(context: MigrationContext): Promise<void>;
}

export interface MigrationContext {
  /** The ledger collection name this run records into. */
  ledgerName: string;
  /** The injected connection, when the runner was given one. */
  connection?: MigrationConnection;
}

/**
 * The three ledger calls `runMigrations` makes, as a structural subset of the
 * mongodb driver's `Collection`. Structural, not nominal, so a real driver
 * collection, a mongoose model's `.collection`, and a test fake all satisfy
 * it without this package binding to any of them.
 */
export interface MigrationLedgerCollection {
  createIndex(keys: object, options?: object): Promise<unknown>;
  findOne(filter: object): Promise<unknown>;
  insertOne(document: object): Promise<unknown>;
}

/** The subset of a mongoose `Connection` this runner uses. */
export interface MigrationConnection {
  readonly db?: { collection(name: string): MigrationLedgerCollection } | null;
}

/** The subset of a mongoose ledger `Model` this runner uses. */
export interface MigrationLedgerModel {
  readonly collection: MigrationLedgerCollection;
}

export interface RunMigrationsOptions {
  /** Injected mongoose connection; the ledger is resolved from `db`. */
  connection?: MigrationConnection;
  /** An already-registered ledger model; its driver collection holds rows. */
  model?: MigrationLedgerModel;
  /** A pre-resolved ledger collection (or a test fake); wins over the others. */
  collection?: MigrationLedgerCollection;
  migrations: Migration[];
  /** Ledger collection name; defaults to {@link DEFAULT_MIGRATION_LEDGER_NAME}. */
  ledgerName?: string;
}

export interface MigrationRunResult {
  /** Migrations this run executed and recorded. */
  applied: string[];
  /** Migrations already in the ledger; `up` was not called for them. */
  skipped: string[];
  /** Migrations executed here whose ledger insert lost to a concurrent runner. */
  raced: string[];
  /** Migrations tagged for the other engine, left for that engine's runner. */
  deferred: string[];
}

export interface MigrationPlan<T> {
  /** Migrations for this engine, in ascending id order. */
  queue: T[];
  /** Ids tagged for the other engine. */
  deferred: string[];
}

/**
 * Validates the id contract (non-empty, unique) and splits a mixed list into
 * an ordered queue for `engine` plus the entries the other engine owns.
 * Shared with `pgMigrations.ts` so both runners order and filter identically.
 */
export function planMigrations<T extends { id: string; engine?: MigrationEngine }>(
  migrations: T[],
  engine: MigrationEngine,
): MigrationPlan<T> {
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (typeof migration.id !== 'string' || migration.id.trim() === '') {
      throw new Error('runMigrations: every migration needs a non-empty id');
    }
    if (seen.has(migration.id)) {
      throw new Error(`runMigrations: duplicate migration id "${migration.id}"`);
    }
    seen.add(migration.id);
  }
  const ordered = [...migrations].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const queue: T[] = [];
  const deferred: string[] = [];
  for (const migration of ordered) {
    if (migration.engine != null && migration.engine !== engine) {
      deferred.push(migration.id);
    } else {
      queue.push(migration);
    }
  }
  return { queue, deferred };
}

/** A duplicate key can surface nested (e.g. a driver wrapping the code). */
function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== 'object' || error == null) {
    return false;
  }
  const candidate = error as { code?: number; codeName?: string; cause?: unknown };
  if (candidate.code === DUPLICATE_KEY_CODE || candidate.codeName === 'DuplicateKey') {
    return true;
  }
  return candidate.cause != null && candidate.cause !== error
    ? isDuplicateKeyError(candidate.cause)
    : false;
}

function resolveLedgerCollection(
  options: RunMigrationsOptions,
  ledgerName: string,
): MigrationLedgerCollection {
  if (options.collection != null) {
    return options.collection;
  }
  if (options.model != null) {
    return options.model.collection;
  }
  const db = options.connection?.db;
  if (db == null) {
    throw new Error(
      'runMigrations: an injected connection, model or ledger collection is required',
    );
  }
  return db.collection(ledgerName);
}

/**
 * Applies pending migrations in ascending id order, recording each applied id
 * in the ledger collection. Idempotent: already-recorded ids are skipped, so
 * the runner is safe to invoke on every boot. A migration that throws is not
 * recorded and its error surfaces to the caller, leaving the run resumable.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<MigrationRunResult> {
  const ledgerName = options.ledgerName ?? DEFAULT_MIGRATION_LEDGER_NAME;
  const collection = resolveLedgerCollection(options, ledgerName);
  const { queue, deferred } = planMigrations(options.migrations, 'mongo');
  const result: MigrationRunResult = { applied: [], skipped: [], raced: [], deferred };

  await buildIndexWithRetry(
    () => collection.createIndex({ id: 1 }, { unique: true }),
    `createIndex(${ledgerName}.id_1)`,
  );

  const context: MigrationContext = { ledgerName, connection: options.connection };
  for (const migration of queue) {
    if ((await collection.findOne({ id: migration.id })) != null) {
      result.skipped.push(migration.id);
      continue;
    }
    await migration.up(context);
    try {
      await collection.insertOne({
        id: migration.id,
        name: migration.name,
        ...(migration.engine != null ? { engine: migration.engine } : {}),
        appliedAt: new Date(),
      });
      result.applied.push(migration.id);
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      result.raced.push(migration.id);
    }
  }

  logger.info(
    `[MigrationLedger] ${ledgerName}: ${result.applied.length} applied, ` +
      `${result.skipped.length} skipped, ${result.raced.length} raced, ` +
      `${result.deferred.length} deferred`,
  );
  return result;
}
