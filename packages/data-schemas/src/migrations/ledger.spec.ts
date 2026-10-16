import type { Migration, MigrationLedgerCollection } from './ledger';
import type { PgMigration, PgQueryExecutor } from './pgMigrations';
import { createPgVectorMigration, runPgMigrations } from './pgMigrations';
import { DEFAULT_MIGRATION_LEDGER_NAME, runMigrations } from './ledger';

interface FakeLedger {
  collection: MigrationLedgerCollection;
  rows: Array<Record<string, unknown>>;
  indexes: Array<{ keys: object; options?: object }>;
  /** When set, findOne reports nothing even when a row exists (a stale concurrent read). */
  staleReads: { value: boolean };
}

function createFakeLedger({ staleReads = false }: { staleReads?: boolean } = {}): FakeLedger {
  const ledger: FakeLedger = {
    rows: [],
    indexes: [],
    staleReads: { value: staleReads },
    collection: {
      async createIndex(keys: object, options?: object) {
        ledger.indexes.push({ keys, options });
        return 'id_1';
      },
      async findOne(filter: object) {
        if (ledger.staleReads.value) {
          return null;
        }
        const { id } = filter as { id: string };
        return ledger.rows.find((row) => row.id === id) ?? null;
      },
      async insertOne(document: object) {
        const row = document as Record<string, unknown>;
        if (ledger.rows.some((existing) => existing.id === row.id)) {
          const error = new Error(
            `E11000 duplicate key error collection: ledger index: id_1 dup key: { id: ${String(row.id)} }`,
          ) as Error & { code: number };
          error.code = 11000;
          throw error;
        }
        ledger.rows.push(row);
        return { acknowledged: true };
      },
    },
  };
  return ledger;
}

function trackingMigration(id: string): { migration: Migration; up: jest.Mock } {
  const up = jest.fn(async () => undefined);
  return { migration: { id, name: `name-${id}`, up }, up };
}

describe('runMigrations (Mongo ledger)', () => {
  it('applies every migration in id order on a fresh ledger and records rows', async () => {
    const ledger = createFakeLedger();
    const executed: string[] = [];
    const migrations: Migration[] = [
      {
        id: '002-indexes',
        name: 'indexes',
        up: async () => {
          executed.push('002-indexes');
        },
      },
      {
        id: '001-init',
        name: 'init',
        up: async () => {
          executed.push('001-init');
        },
      },
    ];

    const result = await runMigrations({ collection: ledger.collection, migrations });

    expect(executed).toEqual(['001-init', '002-indexes']);
    expect(result).toEqual({
      applied: ['001-init', '002-indexes'],
      skipped: [],
      raced: [],
      deferred: [],
    });
    expect(ledger.rows.map((row) => row.id)).toEqual(['001-init', '002-indexes']);
    expect(ledger.rows[0]).toMatchObject({ name: 'init' });
    expect(ledger.rows[0].appliedAt).toBeInstanceOf(Date);
    expect(ledger.indexes).toEqual([{ keys: { id: 1 }, options: { unique: true } }]);
  });

  it('passes the default ledger name to every migration', async () => {
    const ledger = createFakeLedger();
    const first = trackingMigration('001-init');

    await runMigrations({ collection: ledger.collection, migrations: [first.migration] });

    expect(first.up).toHaveBeenCalledWith({
      ledgerName: DEFAULT_MIGRATION_LEDGER_NAME,
      connection: undefined,
    });
  });

  it('applies nothing on a second run and leaves the ledger untouched', async () => {
    const ledger = createFakeLedger();
    const first = trackingMigration('001-init');
    const second = trackingMigration('002-indexes');
    const migrations = [first.migration, second.migration];

    const initial = await runMigrations({ collection: ledger.collection, migrations });
    const rerun = await runMigrations({ collection: ledger.collection, migrations });

    expect(initial.applied).toEqual(['001-init', '002-indexes']);
    expect(rerun).toEqual({
      applied: [],
      skipped: ['001-init', '002-indexes'],
      raced: [],
      deferred: [],
    });
    expect(first.up).toHaveBeenCalledTimes(1);
    expect(second.up).toHaveBeenCalledTimes(1);
    expect(ledger.rows).toHaveLength(2);
  });

  it('swallows a duplicate ledger insert from a concurrent runner', async () => {
    const ledger = createFakeLedger({ staleReads: true });
    ledger.rows.push({ id: '001-init', name: 'peer', appliedAt: new Date() });
    const first = trackingMigration('001-init');

    const result = await runMigrations({
      collection: ledger.collection,
      migrations: [first.migration],
    });

    expect(first.up).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ applied: [], skipped: [], raced: ['001-init'], deferred: [] });
    expect(ledger.rows).toHaveLength(1);
  });

  it('does not record a failing migration, surfaces the error and stops the run', async () => {
    const ledger = createFakeLedger();
    const first = trackingMigration('001-init');
    const failure = new Error('migration exploded');
    const boom: Migration = {
      id: '002-boom',
      name: 'boom',
      up: jest.fn(async () => {
        throw failure;
      }),
    };
    const third = trackingMigration('003-after');

    await expect(
      runMigrations({
        collection: ledger.collection,
        migrations: [first.migration, boom, third.migration],
      }),
    ).rejects.toBe(failure);

    expect(ledger.rows.map((row) => row.id)).toEqual(['001-init']);
    expect(third.up).not.toHaveBeenCalled();
  });

  it('records into the default ledger collection resolved from an injected connection', async () => {
    const ledger = createFakeLedger();
    const requested: string[] = [];
    const connection = {
      db: {
        collection: (name: string) => {
          requested.push(name);
          return ledger.collection;
        },
      },
    };

    await runMigrations({ connection, migrations: [] });

    expect(DEFAULT_MIGRATION_LEDGER_NAME).toBe('_baanzon_migrations');
    expect(requested).toEqual(['_baanzon_migrations']);
  });

  it('honors a custom ledger name', async () => {
    const ledger = createFakeLedger();
    const requested: string[] = [];
    const connection = {
      db: {
        collection: (name: string) => {
          requested.push(name);
          return ledger.collection;
        },
      },
    };

    await runMigrations({ connection, migrations: [], ledgerName: 'custom_ledger' });

    expect(requested).toEqual(['custom_ledger']);
  });

  it('accepts an injected ledger model', async () => {
    const ledger = createFakeLedger();
    const first = trackingMigration('001-init');

    await runMigrations({
      model: { collection: ledger.collection },
      migrations: [first.migration],
    });

    expect(first.up).toHaveBeenCalledTimes(1);
    expect(ledger.rows.map((row) => row.id)).toEqual(['001-init']);
  });

  it('requires an injected connection, model or collection', async () => {
    await expect(runMigrations({ migrations: [] })).rejects.toThrow(
      /connection, model or ledger collection/,
    );
  });

  it('defers migrations tagged for the other engine', async () => {
    const ledger = createFakeLedger();
    const pgTagged: Migration = {
      id: '001-pgvector',
      name: 'pgvector',
      engine: 'pg',
      up: jest.fn(async () => undefined),
    };
    const mongo = trackingMigration('002-mongo');

    const result = await runMigrations({
      collection: ledger.collection,
      migrations: [pgTagged, mongo.migration],
    });

    expect(pgTagged.up).not.toHaveBeenCalled();
    expect(result.deferred).toEqual(['001-pgvector']);
    expect(result.applied).toEqual(['002-mongo']);
    expect(ledger.rows.map((row) => row.id)).toEqual(['002-mongo']);
  });

  it('rejects duplicate migration ids before running anything', async () => {
    const ledger = createFakeLedger();
    const first = trackingMigration('001-init');

    await expect(
      runMigrations({
        collection: ledger.collection,
        migrations: [first.migration, first.migration],
      }),
    ).rejects.toThrow(/duplicate migration id "001-init"/);

    expect(first.up).not.toHaveBeenCalled();
    expect(ledger.rows).toHaveLength(0);
  });
});

/** A stateful fake of the pg statements the runner issues, mirroring pg semantics. */
function createFakePg({ staleReads = false }: { staleReads?: boolean } = {}) {
  const statements: Array<{ text: string; params?: unknown[] }> = [];
  const applied = new Set<string>();
  async function query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
    statements.push({ text, params });
    if (text.includes('CREATE TABLE IF NOT EXISTS')) {
      return { rows: [] };
    }
    if (text.startsWith('SELECT 1 AS present')) {
      const present = !staleReads && applied.has(String(params?.[0]));
      return { rows: (present ? [{ present: 1 }] : []) as T[] };
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
  const executor: PgQueryExecutor = { query };
  return { executor, statements, applied };
}

function pgMigration(id: string): { migration: PgMigration; up: jest.Mock } {
  const up = jest.fn(async () => undefined);
  return { migration: { id, name: `name-${id}`, engine: 'pg', up }, up };
}

describe('runPgMigrations (pg ledger)', () => {
  it('ensures the ledger table, applies migrations in id order and records rows', async () => {
    const fake = createFakePg();
    const first = pgMigration('001-init');
    const second = pgMigration('002-vectors');

    const result = await runPgMigrations({
      query: fake.executor,
      migrations: [second.migration, first.migration],
    });

    expect(result).toEqual({
      applied: ['001-init', '002-vectors'],
      skipped: [],
      raced: [],
      deferred: [],
    });
    expect(fake.statements[0].text).toMatch(/CREATE TABLE IF NOT EXISTS _baanzon_migrations/);
    expect(fake.statements[0].text).toMatch(/id text PRIMARY KEY/);
    expect(fake.applied).toEqual(new Set(['001-init', '002-vectors']));
    expect(first.up).toHaveBeenCalledWith({
      query: fake.executor,
      ledgerTable: '_baanzon_migrations',
    });
  });

  it('applies nothing on a second run', async () => {
    const fake = createFakePg();
    const first = pgMigration('001-init');
    const migrations = [first.migration];

    await runPgMigrations({ query: fake.executor, migrations });
    const rerun = await runPgMigrations({ query: fake.executor, migrations });

    expect(rerun).toEqual({
      applied: [],
      skipped: ['001-init'],
      raced: [],
      deferred: [],
    });
    expect(first.up).toHaveBeenCalledTimes(1);
  });

  it('reports a migration whose ledger insert lost to a concurrent runner as raced', async () => {
    const fake = createFakePg({ staleReads: true });
    fake.applied.add('001-init');
    const first = pgMigration('001-init');

    const result = await runPgMigrations({
      query: fake.executor,
      migrations: [first.migration],
    });

    expect(first.up).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ applied: [], skipped: [], raced: ['001-init'], deferred: [] });
  });

  it('honors a custom ledger table and rejects an unsafe identifier', async () => {
    const fake = createFakePg();
    await runPgMigrations({ query: fake.executor, migrations: [], ledgerTable: 'custom_ledger' });
    expect(fake.statements[0].text).toMatch(/CREATE TABLE IF NOT EXISTS custom_ledger/);

    await expect(
      runPgMigrations({ query: fake.executor, migrations: [], ledgerTable: 'x; DROP TABLE y' }),
    ).rejects.toThrow(/identifier/);
  });

  it('does not record a failing migration and surfaces the error', async () => {
    const fake = createFakePg();
    const failure = new Error('pg migration exploded');
    const boom: PgMigration = {
      id: '001-boom',
      name: 'boom',
      engine: 'pg',
      up: jest.fn(async () => {
        throw failure;
      }),
    };

    await expect(runPgMigrations({ query: fake.executor, migrations: [boom] })).rejects.toBe(
      failure,
    );
    expect(fake.applied.size).toBe(0);
  });
});

describe('createPgVectorMigration', () => {
  it('applies the injected createSchemaSql DDL exactly once across runs', async () => {
    const fake = createFakePg();
    const createSchemaSql = jest.fn(
      (table: string, dimensions: number) =>
        `CREATE EXTENSION IF NOT EXISTS vector;\nCREATE TABLE IF NOT EXISTS ${table} (embedding vector(${dimensions}));`,
    );
    const migration = createPgVectorMigration({
      createSchemaSql,
      table: 'rag_vectors',
      dimensions: 1536,
    });

    expect(migration.id).toBe('001-pgvector-schema');
    expect(migration.engine).toBe('pg');

    const initial = await runPgMigrations({ query: fake.executor, migrations: [migration] });
    expect(createSchemaSql).toHaveBeenCalledWith('rag_vectors', 1536);
    expect(
      fake.statements.some((statement) =>
        statement.text.includes('CREATE TABLE IF NOT EXISTS rag_vectors'),
      ),
    ).toBe(true);
    expect(initial.applied).toEqual(['001-pgvector-schema']);

    const rerun = await runPgMigrations({ query: fake.executor, migrations: [migration] });
    expect(rerun.skipped).toEqual(['001-pgvector-schema']);
    expect(createSchemaSql).toHaveBeenCalledTimes(1);
  });

  it('carries a caller-supplied version tag onto the ledger row', async () => {
    const fake = createFakePg();
    const migration = createPgVectorMigration({
      createSchemaSql: (table) => `CREATE TABLE IF NOT EXISTS ${table} ();`,
      table: 'rag_vectors',
      dimensions: 8,
      id: '007-vectors',
      name: 'vectors',
    });

    await runPgMigrations({ query: fake.executor, migrations: [migration] });

    const ledgerInsert = fake.statements.find((statement) =>
      statement.text.includes('ON CONFLICT (id) DO NOTHING'),
    );
    expect(ledgerInsert?.params).toEqual(['007-vectors', 'vectors', 'pg']);
  });
});
