/**
 * Drift guard for the RAG defaults, which exist in three packages with nothing
 * keeping them equal: the api runtime fallback, the resolver `AppService` calls,
 * and the zod schema both of those are typed against.
 *
 * The divergence is a correctness bug rather than a tidiness one — `validation.ts`
 * rejects a geometry that `chunker.ts` then splits differently — and the two
 * halves of this package reach for different copies of it.
 *
 * These assertions read the *source files*, never an imported constant. A test
 * that imports `RAG_DEFAULTS` and compares it to `ragSchema` proves nothing: it
 * compares one build artifact against another, and both resolve through `dist/`
 * (`librechat-data-provider` and `@librechat/data-schemas` both point `main` at
 * prebuilt output, which is gitignored and rebuilt on a different schedule than
 * the source). A stale artifact would pass such a guard while the shipped
 * values disagreed, which is the failure this file exists to catch.
 */
import { join } from 'path';
import { readFileSync } from 'fs';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

interface GuardedLocation {
  label: string;
  file: string;
  /** Opens and closes the block the defaults live in, so an unrelated key elsewhere cannot satisfy a lookup. */
  open: string;
  close: string;
}

const LOCATIONS: GuardedLocation[] = [
  {
    label: 'packages/api/src/rag/config.ts (RAG_DEFAULTS)',
    file: join(REPO_ROOT, 'packages', 'api', 'src', 'rag', 'config.ts'),
    open: 'export const RAG_DEFAULTS = {',
    close: '} as const;',
  },
  {
    label: 'packages/data-schemas/src/app/rag.ts (RAG_DEFAULTS)',
    file: join(REPO_ROOT, 'packages', 'data-schemas', 'src', 'app', 'rag.ts'),
    open: 'export const RAG_DEFAULTS = {',
    close: '} as const;',
  },
  {
    label: 'packages/data-provider/src/config.ts (ragSchema)',
    file: join(REPO_ROOT, 'packages', 'data-provider', 'src', 'config.ts'),
    open: 'export const ragSchema = z.object({',
    close: '\n});',
  },
];

/**
 * `[key, expected]` — spelled out here, so changing any copy has to be deliberate.
 *
 * `inMemoryMaxCollections` is in the list for the same reason the geometry is:
 * it is written out three times with nothing keeping the copies equal, and it is
 * a ceiling a deployment can hit, not a tuning knob. The store refuses an
 * ingest past it with a 409 whose message names the limit
 * (`In-memory vector store is full (N collections)`, `vectorStores.ts`), and
 * `listCollections` reports what is left as `capacity` — so a copy that drifted
 * to 50 would silently halve what a deployment can hold, and the drift guard is
 * the only thing that would notice.
 */
const GEOMETRY: [string, number][] = [
  ['chunkSize', 800],
  ['chunkOverlap', 80],
  ['inMemoryMaxCollections', 200],
  ['inMemoryMaxChunks', 20000],
];

const DISABLED = 'true';
const GEOMETRY_KEYS = GEOMETRY.map(([key]) => key);

/**
 * The ingest-side embedder's three bounds, guarded for the same reason the
 * geometry is: they are written out in three packages with nothing keeping the
 * copies equal, and every one of them is a number a deployment can be hurt by
 * rather than a tuning knob. A `embeddingTimeoutMs` that drifted to 500 would
 * abandon most of a real provider's batches; a `embeddingBatchSize` that drifted
 * to 1 would turn one large ingest into a round trip per chunk and hold the
 * write open for it.
 */
const EMBED_LIMITS: [string, number][] = [
  ['embeddingTimeoutMs', 15000],
  ['embeddingBatchSize', 64],
  ['embeddingConcurrency', 2],
];
const EMBED_LIMIT_KEYS = EMBED_LIMITS.map(([key]) => key);
const GUARDED_KEYS = [...GEOMETRY_KEYS, ...EMBED_LIMIT_KEYS];

function readSource(location: GuardedLocation): string {
  return readFileSync(location.file, 'utf8');
}

function guardedBlock(location: GuardedLocation): string {
  const source = readSource(location);
  const from = source.indexOf(location.open);
  if (from < 0) {
    throw new Error(`${location.label}: no \`${location.open}\` in the source file`);
  }
  const to = source.indexOf(location.close, from + location.open.length);
  if (to < 0) {
    throw new Error(
      `${location.label}: the guarded block is never closed by \`${location.close}\``,
    );
  }
  return source.slice(from, to);
}

/**
 * Reads one default as written, from either a bare object literal
 * (`chunkSize: 800`) or a zod default call (`chunkSize: z.number()....default(800)`).
 * Returns the text, so a failure quotes what the file actually says.
 */
function readLiteral(location: GuardedLocation, key: string): string {
  const line = guardedBlock(location)
    .split('\n')
    .find((candidate) => new RegExp(`^ {2}${key}:`).test(candidate));
  if (line == null) {
    throw new Error(`${location.label}: no \`${key}\` default in the guarded block`);
  }
  const zodDefault = /\.default\(([^)]*)\)/.exec(line);
  return (zodDefault != null ? zodDefault[1] : line.replace(/^[^:]*:\s*/, ''))
    .trim()
    .replace(/,$/, '');
}

/** `20_000` and `20000` are the same default, and the build emits `2e4` for it. */
function toNumber(literal: string): number {
  return Number(literal.replace(/_/g, ''));
}

function defaultsIn(location: GuardedLocation): Record<string, string> {
  const values: Record<string, string> = { disabled: readLiteral(location, 'disabled') };
  for (const key of GUARDED_KEYS) {
    values[key] = readLiteral(location, key);
  }
  return values;
}

describe('RAG default drift guard', () => {
  describe.each(LOCATIONS)('$label', (location) => {
    it.each([...GEOMETRY, ...EMBED_LIMITS])('%s defaults to %d', (key, expected) => {
      expect(toNumber(readLiteral(location, key))).toBe(expected);
    });

    it('disables the feature by default', () => {
      expect(readLiteral(location, 'disabled')).toBe(DISABLED);
    });
  });

  it('all three copies agree on every guarded default', () => {
    const seen = LOCATIONS.map(defaultsIn);
    for (const key of [...GUARDED_KEYS, 'disabled']) {
      const normalize = key === 'disabled' ? (value: string) => value : toNumber;
      const values = seen.map((copy) => normalize(copy[key]));
      expect(values).toEqual(values.map(() => values[0]));
    }
  });

  /**
   * The resolver has to read its default from the constant rather than
   * re-hardcode it, or this file keeps passing after the served value flips.
   */
  it('the data-schemas resolver falls back to RAG_DEFAULTS.disabled', () => {
    const location = LOCATIONS[1];
    const resolver = readSource(location).slice(
      readSource(location).indexOf('export function loadRagConfig'),
    );
    expect(resolver).toContain('source.disabled ?? RAG_DEFAULTS.disabled');
  });
});
