/**
 * Request validation for the RAG routes.
 *
 * `validation.ts` is the only gate between a client's JSON and the durable
 * collection metadata, and it is not reachable from `routes.spec.ts` or
 * `service.spec.ts`, so every rejection below had no coverage at all. That
 * matters more for chunk geometry than for the rest: a bad `name` fails one
 * request, while a bad `chunkSize`/`chunkOverlap` pair is *persisted with the
 * collection* and detonates on every later ingest for it — or, worse, is
 * accepted and silently changes how the corpus is cut.
 *
 * Two things are pinned deliberately, and neither is reachable from a
 * happy-path route test:
 *  - the exact message of every rejection, because these strings are the
 *    caller's only description of what to fix;
 *  - the *status* the message travels as, because a rejection that surfaced as
 *    a 500 would page an operator for a client typo.
 *
 * The defaults asserted here (800 / 80) are `RAG_DEFAULTS` from `./config`.
 * The same numbers are duplicated in `packages/data-schemas/src/app/rag.ts` and
 * in `ragSchema` in `packages/data-provider/src/config.ts`; this file asserts
 * the copy that actually resolves the value at runtime.
 */
import { SystemRoles } from 'librechat-data-provider';
import type { Response } from 'express';
import type { CollectionScope, KnowledgeCollection } from './types';
import type { MongoKnowledgeStoreDeps } from './knowledgeStore';
import type { RagRoutes } from './routes';
import {
  validateAddDocument,
  validateCollectionPatch,
  validateCreateCollection,
  validateRetrieve,
} from './validation';
import { InMemoryVectorStore } from './vectorStores';
import { createRagRoutes } from './routes';
import { RAG_DEFAULTS } from './config';
import { chunkText } from './chunker';

/** Geometry bounds, mirrored from `validation.ts` so a change there fails here. */
const CHUNK_SIZE_MIN = 16;
const CHUNK_SIZE_MAX = 8_000;
const NAME_MAX = 64;
const DESC_MAX = 512;
const CONTENT_MAX = 400_000;
const QUERY_MAX = 2_000;

type RagRouteRequest = Parameters<RagRoutes['createCollection']>[0];
type AppConfig = NonNullable<RagRouteRequest['config']>;
type RagUser = NonNullable<RagRouteRequest['user']>;

const ADMIN: RagUser = { id: 'admin-1', role: SystemRoles.ADMIN };
const USER: RagUser = { id: 'u-1', role: SystemRoles.USER };

function createResponse(): Response {
  const response = {} as Response;
  response.status = jest.fn(() => response);
  response.json = jest.fn(() => response);
  return response;
}

/**
 * The RAG block is set on every request rather than left to resolve from
 * nothing, so a test in this file never depends on what `rag.disabled` currently
 * defaults to. `Object.assign` means a caller can still hand it `undefined`
 * explicitly to exercise the no-config path.
 */
const ENABLED_CONFIG = { rag: { disabled: false } } as AppConfig;

/**
 * An enabled deployment that also configures retrieval tuning, so a test can
 * pin the *effective* chunk size rather than the one a deployment gets by
 * configuring nothing. The default is asserted through `RAG_DEFAULTS`.
 */
const configWithRag = (rag: Record<string, unknown>): AppConfig =>
  ({ rag: { disabled: false, ...rag } }) as AppConfig;

function createRequest(overrides: Partial<RagRouteRequest> = {}): RagRouteRequest {
  return Object.assign(
    {} as RagRouteRequest,
    { body: {}, params: {}, config: ENABLED_CONFIG },
    overrides,
  );
}

const bodyOf = (response: Response): unknown => jest.mocked(response.json).mock.calls[0][0];
const statusOf = (response: Response): number | undefined =>
  jest.mocked(response.status).mock.calls[0]?.[0];

/**
 * The route's request DTO declares `chunkSize?: number` and `scope?: CollectionScope`,
 * so a JSON body carrying a string or an unknown scope — which any client can
 * send — cannot be written without a cast. The DTO types what a *typed* caller
 * may pass; `validation.ts` is the gate for what actually arrives, which is why
 * these cases exist at all.
 */
const rawBody = (body: Record<string, unknown>): RagRouteRequest['body'] => body;

/**
 * Enough of a store for a request to succeed, and instrumented so a test can
 * assert that a rejected request never reached it. Rows live in a `Map`, so
 * these are the same semantics as the real adapter minus the durability.
 */
function setup() {
  const rows = new Map<string, KnowledgeCollection>();
  const visible = (row: KnowledgeCollection, userId: string) =>
    row.userId === userId || row.scope === 'global';

  const knowledgeMethods: MongoKnowledgeStoreDeps = {
    createKnowledgeCollection: jest.fn(async (input) => {
      const now = new Date().toISOString();
      const row: KnowledgeCollection = {
        ...input,
        documentCount: 0,
        chunkCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(row.id, row);
      return row;
    }),
    getKnowledgeCollection: jest.fn(async (userId, collectionId) => {
      const row = rows.get(collectionId);
      return row != null && visible(row, userId) ? row : null;
    }),
    listKnowledgeCollections: jest.fn(async (userId) =>
      [...rows.values()].filter((row) => visible(row, userId)),
    ),
    updateKnowledgeCollection: jest.fn(async (userId, collectionId, patch) => {
      const row = rows.get(collectionId);
      if (row == null || row.userId !== userId) {
        return null;
      }
      const next = { ...row, ...patch };
      rows.set(collectionId, next);
      return next;
    }),
    bumpKnowledgeCollectionStats: jest.fn(async () => null),
    deleteKnowledgeCollection: jest.fn(async () => false),
  };

  const routes = createRagRoutes({
    knowledgeMethods,
    vectorStore: new InMemoryVectorStore(),
  });
  /** Exposed so a test can seed a row the current API can no longer produce. */
  return { routes, knowledgeMethods, rows };
}

describe('RAG request validation', () => {
  describe('validateCreateCollection', () => {
    describe('chunk geometry the body omits', () => {
      it('accepts a create body that carries no geometry at all', () => {
        expect(validateCreateCollection({ name: 'handbook' })).toEqual({ ok: true });
      });

      it('rejects a body that is missing the name even when the geometry is valid', () => {
        expect(validateCreateCollection({ chunkSize: 800, chunkOverlap: 80 })).toEqual({
          ok: false,
          error: 'name is required',
        });
      });

      /**
       * The validator applies no default of its own — with the geometry absent
       * it has nothing to check, and the service fills the fields from the
       * resolved config. So the number that reaches storage is `RAG_DEFAULTS`,
       * asserted here as the actual value rather than as "something was set":
       * a validator that grew its own constants would leave this test green,
       * and that is the drift this file exists to make visible.
       */
      it('stores the resolved deployment defaults when the body omits the geometry', async () => {
        const { routes } = setup();
        const response = createResponse();

        await routes.createCollection(createRequest({ body: { name: 'handbook' } }), response);

        expect(statusOf(response)).toBe(201);
        const created = bodyOf(response) as KnowledgeCollection;
        expect(created.chunkSize).toBe(800);
        expect(created.chunkOverlap).toBe(80);
        expect(created.chunkSize).toBe(RAG_DEFAULTS.chunkSize);
        expect(created.chunkOverlap).toBe(RAG_DEFAULTS.chunkOverlap);
      });

      it('still applies those defaults when only one half of the geometry is sent', async () => {
        const { routes } = setup();
        const response = createResponse();

        await routes.createCollection(
          createRequest({ body: { name: 'handbook', chunkOverlap: 120 } }),
          response,
        );

        expect(statusOf(response)).toBe(201);
        const created = bodyOf(response) as KnowledgeCollection;
        expect(created.chunkOverlap).toBe(120);
        expect(created.chunkSize).toBe(RAG_DEFAULTS.chunkSize);
      });
    });

    describe('explicit geometry it accepts', () => {
      it.each([
        ['the deployment defaults', 800, 80],
        ['no overlap at all', 512, 0],
        ['the minimum chunk size', CHUNK_SIZE_MIN, 0],
        ['overlap one below the chunk size', CHUNK_SIZE_MAX, CHUNK_SIZE_MAX - 1],
        ['a small size with a large relative overlap', 16, 15],
      ])('accepts %s', (_label, chunkSize, chunkOverlap) => {
        expect(validateCreateCollection({ name: 'kb', chunkSize, chunkOverlap })).toEqual({
          ok: true,
        });
      });

      it('carries the explicit geometry through to the stored collection', async () => {
        const { routes } = setup();
        const response = createResponse();

        await routes.createCollection(
          createRequest({ body: { name: 'kb', chunkSize: 512, chunkOverlap: 64 } }),
          response,
        );

        expect(statusOf(response)).toBe(201);
        const created = bodyOf(response) as KnowledgeCollection;
        expect(created.chunkSize).toBe(512);
        expect(created.chunkOverlap).toBe(64);
      });
    });

    describe('geometry it rejects', () => {
      it.each([
        ['one below the minimum', { chunkSize: CHUNK_SIZE_MIN - 1 }],
        ['one above the maximum', { chunkSize: CHUNK_SIZE_MAX + 1 }],
        ['zero', { chunkSize: 0 }],
        ['a negative size', { chunkSize: -100 }],
      ])('rejects a chunk size of %s', (_label, geometry) => {
        expect(validateCreateCollection({ name: 'kb', ...geometry })).toEqual({
          ok: false,
          error: `chunkSize must be between ${CHUNK_SIZE_MIN} and ${CHUNK_SIZE_MAX}`,
        });
      });

      it.each([
        ['a non-integer size', { chunkSize: 800.5 }],
        ['NaN', { chunkSize: Number.NaN }],
        ['Infinity', { chunkSize: Number.POSITIVE_INFINITY }],
        ['-Infinity', { chunkSize: Number.NEGATIVE_INFINITY }],
        ['a numeric string', { chunkSize: '800' }],
        ['null', { chunkSize: null }],
        ['a boolean', { chunkSize: true }],
        ['an array', { chunkSize: [800] }],
        ['an object', { chunkSize: { value: 800 } }],
      ])('rejects %s for chunkSize', (_label, geometry) => {
        expect(validateCreateCollection({ name: 'kb', ...geometry })).toEqual({
          ok: false,
          error: 'chunkSize must be an integer',
        });
      });

      it.each([['a negative overlap', { chunkOverlap: -1 }]])('rejects %s', (_label, geometry) => {
        expect(validateCreateCollection({ name: 'kb', chunkSize: 800, ...geometry })).toEqual({
          ok: false,
          error: 'chunkOverlap must be >= 0',
        });
      });

      it.each([
        ['a non-integer overlap', { chunkOverlap: 79.5 }],
        ['NaN', { chunkOverlap: Number.NaN }],
        ['Infinity', { chunkOverlap: Number.POSITIVE_INFINITY }],
        ['-Infinity', { chunkOverlap: Number.NEGATIVE_INFINITY }],
        ['a numeric string', { chunkOverlap: '80' }],
        ['null', { chunkOverlap: null }],
      ])('rejects %s for chunkOverlap', (_label, geometry) => {
        expect(validateCreateCollection({ name: 'kb', chunkSize: 800, ...geometry })).toEqual({
          ok: false,
          error: 'chunkOverlap must be an integer',
        });
      });

      it.each([
        ['equal to the chunk size', 800, 800],
        ['larger than the chunk size', 800, 900],
        ['equal to the minimum chunk size', CHUNK_SIZE_MIN, CHUNK_SIZE_MIN],
      ])('rejects an overlap %s', (_label, chunkSize, chunkOverlap) => {
        expect(validateCreateCollection({ name: 'kb', chunkSize, chunkOverlap })).toEqual({
          ok: false,
          error: 'chunkOverlap must be less than chunkSize',
        });
      });

      it('reports the size before the overlap when both are wrong', () => {
        expect(validateCreateCollection({ name: 'kb', chunkSize: 8, chunkOverlap: 99 })).toEqual({
          ok: false,
          error: `chunkSize must be between ${CHUNK_SIZE_MIN} and ${CHUNK_SIZE_MAX}`,
        });
      });
    });

    describe('name, description and scope', () => {
      it.each([
        ['absent', {}],
        ['empty', { name: '' }],
        ['whitespace only', { name: '   ' }],
        ['a tab and a newline only', { name: '\t\n' }],
        ['a non-string', { name: 42 }],
        ['null', { name: null }],
      ])('rejects a name that is %s', (_label, body) => {
        expect(validateCreateCollection(body)).toEqual({ ok: false, error: 'name is required' });
      });

      it('accepts a name of exactly the maximum length', () => {
        expect(validateCreateCollection({ name: 'a'.repeat(NAME_MAX) })).toEqual({ ok: true });
      });

      it('rejects a name one character over the maximum', () => {
        expect(validateCreateCollection({ name: 'a'.repeat(NAME_MAX + 1) })).toEqual({
          ok: false,
          error: `name must be <= ${NAME_MAX} characters`,
        });
      });

      it('accepts surrounding whitespace on a name, because the length is measured trimmed', () => {
        expect(validateCreateCollection({ name: '  handbook  ' })).toEqual({ ok: true });
      });

      it('accepts a name that is non-ASCII', () => {
        expect(validateCreateCollection({ name: '知识库 📚' })).toEqual({ ok: true });
      });

      it('accepts a description of exactly the maximum length', () => {
        expect(validateCreateCollection({ name: 'kb', description: 'd'.repeat(DESC_MAX) })).toEqual(
          { ok: true },
        );
      });

      it('rejects a description one character over the maximum', () => {
        expect(
          validateCreateCollection({ name: 'kb', description: 'd'.repeat(DESC_MAX + 1) }),
        ).toEqual({ ok: false, error: `description must be <= ${DESC_MAX} characters` });
      });

      it.each([['private'], ['global']])('accepts the %s scope', (scope) => {
        expect(validateCreateCollection({ name: 'kb', scope })).toEqual({ ok: true });
      });

      /**
       * `project` is rejected here, not merely unused. It used to be accepted,
       * stored, and read back exactly like a private one — visibility is
       * owner-or-`global` — so it was a control that silently did nothing. An
       * API client could mint phantom project collections regardless of what
       * the UI offers, so the server has to stop taking it.
       *
       * Unconditional, and so a different failure from `global`: `global` is a
       * well-formed scope that only an admin may use (403, decided in the
       * service), whereas `project` is not a scope this deployment has (400,
       * decided here). Conflating them would tell a caller to retry or escalate
       * for something no role can ever make valid.
       */
      it.each([
        ['project', { scope: 'project' }],
        ['an unknown scope', { scope: 'admin' }],
        ['a differently cased scope', { scope: 'Private' }],
        ['an empty scope', { scope: '' }],
        ['a non-string scope', { scope: 1 }],
        ['null', { scope: null }],
      ])('rejects %s', (_label, body) => {
        expect(validateCreateCollection({ name: 'kb', ...body })).toEqual({
          ok: false,
          error: 'scope must be one of: private, global',
        });
      });

      it('reports the name before the geometry, so a bad name is not masked by a bad size', () => {
        expect(validateCreateCollection({ name: '', chunkSize: 0 })).toEqual({
          ok: false,
          error: 'name is required',
        });
      });
    });

    /**
     * The two gaps this file recorded as findings, now closed. Both were
     * accepted silently and both persisted their result, so each one handed
     * the caller geometry or a name cap the caller never asked for.
     */
    describe('geometry validated against the effective chunk size', () => {
      it.each([
        ['far above the default chunk size', 1_000_000],
        ['equal to it', RAG_DEFAULTS.chunkSize],
        ['one above it', RAG_DEFAULTS.chunkSize + 1],
      ])('rejects an overlap %s when the body omits chunkSize', (_label, chunkOverlap) => {
        // The comparison used to run only against a `chunkSize` the body
        // happened to carry, so this arrived at the collection as 1,000,000
        // against a stored size of 800 — and the chunker then caps the overlap
        // at half the size, making the stored and effective geometries produce
        // identical chunks. The caller's number was discarded, silently.
        expect(validateCreateCollection({ name: 'kb', chunkOverlap })).toEqual({
          ok: false,
          error: 'chunkOverlap must be less than chunkSize',
        });
      });

      it.each([
        ['one below it', RAG_DEFAULTS.chunkSize - 1],
        ['no overlap at all', 0],
      ])('accepts an overlap %s when the body omits chunkSize', (_label, chunkOverlap) => {
        // The boundary is inclusive, so 799 against an 800 default has to
        // pass — a fix that rejected `>=` on the default but not on an explicit
        // size would have narrowed the accepted set at exactly one value.
        expect(validateCreateCollection({ name: 'kb', chunkOverlap })).toEqual({ ok: true });
      });

      it('rejects rather than clamping, so the stored value is the value asked for', () => {
        // A clamp would make the stored overlap differ from the requested one
        // without saying so, which is the failure this validator exists to
        // prevent. Every other geometry error here is a rejection too.
        const rejected = validateCreateCollection({ name: 'kb', chunkOverlap: 1_000_000 });
        expect(rejected.ok).toBe(false);
        expect(rejected.error).toBe('chunkOverlap must be less than chunkSize');
      });

      it('is the right call because the chunker would otherwise ignore the overlap', () => {
        // Why rejection rather than a silent pass: `chunkText` caps the overlap
        // at half the size, so a stored 1,000,000 and the effective 400 produce
        // identical chunks. The corpus was cut a particular way and nothing
        // reported it, which is the "bad geometry changes how the corpus is cut
        // and says nothing" outcome the rejections above exist to prevent.
        const text = 'a'.repeat(2000);
        expect(chunkText(text, 800, 1_000_000)).toEqual(chunkText(text, 800, 400));
      });

      it('rejects a huge overlap whether or not the body carries a chunk size', () => {
        expect(validateCreateCollection({ name: 'kb', chunkOverlap: 1_000_000 }).ok).toBe(false);
        expect(
          validateCreateCollection({ name: 'kb', chunkSize: 800, chunkOverlap: 1_000_000 }),
        ).toEqual({ ok: false, error: 'chunkOverlap must be less than chunkSize' });
      });

      it('never stores an overlap the effective size would silently discard', async () => {
        const { routes } = setup();
        const response = createResponse();

        await routes.createCollection(
          createRequest({ body: { name: 'kb', chunkOverlap: 1_000_000 } }),
          response,
        );

        expect(statusOf(response)).toBe(400);
        expect(bodyOf(response)).toEqual({ error: 'chunkOverlap must be less than chunkSize' });
      });
    });

    /**
     * The block above closes the gap against `RAG_DEFAULTS`, which is the size a
     * deployment gets by configuring *nothing*. A deployment that configures
     * `rag.chunkSize` gets a different number, the service stores that one
     * (`params.chunkSize ?? deps.config.chunkSize`), and a validator that only
     * knew the default was checking the request against a size the collection
     * would never have. So the resolved config is an argument, and these cases
     * pin the precedence: request → resolved config → default.
     */
    describe('geometry validated against the *configured* chunk size', () => {
      const CONFIGURED = 200;
      const OVERLAP = 500;

      it('rejects an overlap the configured chunk size could not support', () => {
        // The case from the field report: 500 < 800, so the old gate passed it,
        // and the collection was then stored as 500-against-200 — the exact
        // degenerate geometry the block above exists to prevent.
        expect(
          validateCreateCollection(
            { name: 'kb', chunkOverlap: OVERLAP },
            { chunkSize: CONFIGURED },
          ),
        ).toEqual({ ok: false, error: 'chunkOverlap must be less than chunkSize' });
      });

      it.each([
        ['one below the configured size', CONFIGURED - 1, true],
        ['no overlap at all', 0, true],
        ['equal to the configured size', CONFIGURED, false],
        ['one above the configured size', CONFIGURED + 1, false],
        ['far above it', 1_000_000, false],
      ])('verdict for an overlap %s against a configured size of 200: %s', (_l, overlap, ok) => {
        // The boundary is `overlap < size`, so 199 against 200 has to pass.
        // A fix that rejected at-or-above the configured size but not at-or-above
        // an explicit one would have moved the accepted set at exactly one value.
        expect(
          validateCreateCollection({ name: 'kb', chunkOverlap: overlap }, { chunkSize: CONFIGURED })
            .ok,
        ).toBe(ok);
      });

      /**
       * The test that would have caught it. One request, two deployments: the
       * only thing that changes is `rag.chunkSize`, and the verdict has to
       * change with it. Every other case in the file is one config or the
       * other, so a gate that silently ignored the configured size passed all
       * of them.
       */
      it('gives the same request different verdicts under two configured chunk sizes', async () => {
        const body = { name: 'kb', chunkOverlap: OVERLAP };

        const small = setup();
        const smallResponse = createResponse();
        await small.routes.createCollection(
          createRequest({ body, config: configWithRag({ chunkSize: CONFIGURED }) }),
          smallResponse,
        );

        const large = setup();
        const largeResponse = createResponse();
        await large.routes.createCollection(
          createRequest({ body, config: configWithRag({ chunkSize: RAG_DEFAULTS.chunkSize }) }),
          largeResponse,
        );

        expect(statusOf(smallResponse)).toBe(400);
        expect(bodyOf(smallResponse)).toEqual({
          error: 'chunkOverlap must be less than chunkSize',
        });
        expect(statusOf(largeResponse)).toBe(201);
        // And the one that was accepted stored the size it was accepted against,
        // so the verdict and the stored geometry agree.
        expect((bodyOf(largeResponse) as KnowledgeCollection).chunkSize).toBe(
          RAG_DEFAULTS.chunkSize,
        );
        for (const method of Object.values(small.knowledgeMethods)) {
          expect(method).not.toHaveBeenCalled();
        }
      });

      it('stores the configured chunk size when the body omits one', async () => {
        // The other half of the same fix: the gate and the store agree on one
        // number, so the accepted request is stored with the size it was
        // checked against.
        const { routes } = setup();
        const response = createResponse();

        await routes.createCollection(
          createRequest({
            body: { name: 'kb', chunkOverlap: CONFIGURED - 1 },
            config: configWithRag({ chunkSize: CONFIGURED }),
          }),
          response,
        );

        expect(statusOf(response)).toBe(201);
        expect(bodyOf(response)).toMatchObject({ chunkSize: CONFIGURED, chunkOverlap: 199 });
      });

      it('still applies the configured overlap when the body omits one', async () => {
        const { routes } = setup();
        const response = createResponse();

        await routes.createCollection(
          createRequest({
            body: { name: 'kb' },
            config: configWithRag({ chunkSize: CONFIGURED, chunkOverlap: 20 }),
          }),
          response,
        );

        expect(statusOf(response)).toBe(201);
        expect(bodyOf(response)).toMatchObject({ chunkSize: CONFIGURED, chunkOverlap: 20 });
      });

      /**
       * The limit of this gate, pinned so it is not mistaken for coverage. It
       * judges the overlap the *caller* sent; a deployment whose own configured
       * pair is incoherent (`chunkSize: 20` with `chunkOverlap: 80`) is a config
       * problem, and no request can be blamed for it — so the create is
       * accepted rather than refused.
       *
       * The pair the caller never sees is resolved by the *service*, not here:
       * `configuredGeometry` (`service.ts`) stores the overlap the chunker will
       * actually apply, so a collection cannot end up recording a geometry its
       * own index never used. That is the counterpart to this validator's
       * refusal — between them a stored `chunkOverlap` is always one that will
       * be applied — and the two halves are not interchangeable, which is why
       * this test asserts the number and not just the status.
       */
      it('judges only the overlap the caller sent, not the configured pair', async () => {
        const { routes } = setup();
        const response = createResponse();

        await routes.createCollection(
          createRequest({
            body: { name: 'kb' },
            config: configWithRag({ chunkSize: 20, chunkOverlap: 80 }),
          }),
          response,
        );

        expect(statusOf(response)).toBe(201);
        // `min(80, floor(20 / 2))`: the stored overlap is the one ingest uses.
        expect(bodyOf(response)).toMatchObject({ chunkSize: 20, chunkOverlap: 10 });
      });

      /**
       * The request wins. A body that names its own `chunkSize` is asking for
       * that size to be stored, and it is the number the overlap has to fit
       * inside, whatever the deployment prefers. Both directions are pinned,
       * because "the configured value is used" is satisfied by an implementation
       * that ignores the body entirely.
       */
      it.each([
        ['above', 800, RAG_DEFAULTS.chunkSize, OVERLAP, true],
        ['below', CONFIGURED, RAG_DEFAULTS.chunkSize, OVERLAP, false],
      ])(
        'lets an explicit chunk size %s the configured one decide the verdict',
        (_label, explicit, configured, overlap, ok) => {
          expect(
            validateCreateCollection(
              { name: 'kb', chunkSize: explicit, chunkOverlap: overlap },
              { chunkSize: configured },
            ).ok,
          ).toBe(ok);
        },
      );

      it('stores the explicit size, not the configured one, when both are sent', async () => {
        const { routes } = setup();
        const response = createResponse();

        await routes.createCollection(
          createRequest({
            body: { name: 'kb', chunkSize: RAG_DEFAULTS.chunkSize, chunkOverlap: OVERLAP },
            config: configWithRag({ chunkSize: CONFIGURED }),
          }),
          response,
        );

        expect(statusOf(response)).toBe(201);
        expect(bodyOf(response)).toMatchObject({
          chunkSize: RAG_DEFAULTS.chunkSize,
          chunkOverlap: OVERLAP,
        });
      });

      it('leaves the default-only verdicts unchanged when no config reaches the validator', () => {
        // The whole existing suite calls the validator with one argument, which
        // is a deployment that configured nothing. Those verdicts must not move:
        // the fix is a wider comparison basis, not a stricter gate.
        expect(validateCreateCollection({ name: 'kb', chunkOverlap: OVERLAP })).toEqual({
          ok: true,
        });
        expect(
          validateCreateCollection({ name: 'kb', chunkOverlap: RAG_DEFAULTS.chunkSize }),
        ).toEqual({ ok: false, error: 'chunkOverlap must be less than chunkSize' });
        expect(
          validateCreateCollection({ name: 'kb', chunkOverlap: RAG_DEFAULTS.chunkSize - 1 }),
        ).toEqual({ ok: true });
        expect(validateCreateCollection({ name: 'kb' }, { chunkSize: undefined })).toEqual({
          ok: true,
        });
      });
    });

    describe('the name cap counts characters, not UTF-16 code units', () => {
      /** 32 emoji are 64 code units but 32 characters. */
      const emoji = (n: number) => '📚'.repeat(n);

      it.each([
        [64, true],
        [65, false],
      ])('verdict for %i ASCII characters: %s', (length, ok) => {
        const result = validateCreateCollection({ name: 'a'.repeat(length) });
        expect(result.ok).toBe(ok);
        if (!ok) {
          expect(result.error).toBe(`name must be <= ${NAME_MAX} characters`);
        }
      });

      it.each([
        [32, true],
        [33, true],
        [NAME_MAX, true],
        [NAME_MAX + 1, false],
      ])('verdict for %i emoji: %s', (count, ok) => {
        // The old boundary was 32/33, because each emoji is a surrogate pair and
        // `String.length` counts two units per character — so an emoji-only
        // name got half the documented cap. Under code points the cap is where
        // it says it is, and 33 (66 code units) is accepted.
        const result = validateCreateCollection({ name: emoji(count) });
        expect(result.ok).toBe(ok);
        if (!ok) {
          expect(result.error).toBe(`name must be <= ${NAME_MAX} characters`);
        }
      });

      it('does not let a longer string through by measuring characters instead of units', () => {
        // Counting code points can only ever admit *more* input, so this is the
        // direction that needed checking: the longest accepted name is 64
        // characters whatever it is made of, never 64 code units.
        const accepted = emoji(NAME_MAX);
        expect([...accepted].length).toBe(NAME_MAX);
        expect(accepted.length).toBe(NAME_MAX * 2);
        expect(validateCreateCollection({ name: emoji(NAME_MAX + 1) }).ok).toBe(false);
      });

      it('judges a mixed name by characters, where the two lengths disagree', () => {
        // 32 emoji + 2 ASCII: 66 code units (over the cap) but 34 characters
        // (under it). Before the fix this was refused, because the surrogate
        // pairs were each counted twice.
        const mixed = emoji(32) + 'ab';
        expect(mixed.length).toBe(66);
        expect([...mixed].length).toBe(34);
        expect(validateCreateCollection({ name: mixed })).toEqual({ ok: true });
      });

      it('still refuses a mixed name that is genuinely over the character cap', () => {
        // 33 emoji + 32 ASCII: 65 characters, which is one too many however the
        // string is measured.
        expect(validateCreateCollection({ name: emoji(33) + 'a'.repeat(32) })).toEqual({
          ok: false,
          error: `name must be <= ${NAME_MAX} characters`,
        });
      });

      it('accepts a mixed name of exactly the character cap', () => {
        expect(validateCreateCollection({ name: emoji(32) + 'a'.repeat(32) })).toEqual({
          ok: true,
        });
      });

      it('applies the same cap to a patch', () => {
        expect(validateCollectionPatch({ name: emoji(32) })).toEqual({ ok: true });
        expect(validateCollectionPatch({ name: emoji(33) })).toEqual({ ok: true });
        expect(validateCollectionPatch({ name: emoji(NAME_MAX + 1) })).toEqual({
          ok: false,
          error: `name must be 1..${NAME_MAX} characters`,
        });
      });
    });

    /**
     * The same defect in the two caps that were left behind, and the reason it
     * is a defect rather than a preference: `name` and `description` are two
     * fields of one document, and both messages say "characters". A caller
     * typing emoji into either one had to guess which of them halved.
     *
     * `content` is deliberately *not* in this block — it is a body-size guard,
     * not a character budget, and the check says so where it lives.
     */
    describe('the description and query caps count characters too', () => {
      /** Each emoji is a surrogate pair: two code units, one character. */
      const emoji = (n: number) => '📚'.repeat(n);

      describe('description', () => {
        const message = `description must be <= ${DESC_MAX} characters`;

        it.each([
          [DESC_MAX, true],
          [DESC_MAX + 1, false],
        ])('verdict for %i ASCII characters: %s', (length, ok) => {
          const result = validateCreateCollection({ name: 'kb', description: 'd'.repeat(length) });
          expect(result.ok).toBe(ok);
          if (!ok) {
            expect(result.error).toBe(message);
          }
        });

        it.each([
          [DESC_MAX / 2, true],
          [DESC_MAX / 2 + 1, true],
          [DESC_MAX, true],
          [DESC_MAX + 1, false],
        ])('verdict for %i emoji: %s', (count, ok) => {
          // 256 emoji is exactly the cap in code units and exactly half of it in
          // characters. That value is the one that flipped: it used to sit right
          // on the boundary and 257 was refused, so an emoji-only description
          // got 256 characters where 512 were advertised.
          const result = validateCreateCollection({ name: 'kb', description: emoji(count) });
          expect(result.ok).toBe(ok);
          if (!ok) {
            expect(result.error).toBe(message);
          }
        });

        it('measures a mixed description by characters, where the two lengths disagree', () => {
          // 300 emoji + 10 ASCII: 610 code units (over the cap) but 310
          // characters (under it), which is the verdict a caller reads off the
          // message.
          const mixed = emoji(300) + 'd'.repeat(10);
          expect(mixed.length).toBe(610);
          expect([...mixed].length).toBe(310);
          expect(validateCreateCollection({ name: 'kb', description: mixed })).toEqual({
            ok: true,
          });
        });

        it('still refuses a mixed description that is genuinely over the cap', () => {
          expect(
            validateCreateCollection({ name: 'kb', description: emoji(DESC_MAX + 1) }),
          ).toEqual({ ok: false, error: message });
        });

        it('applies the same cap to a patch, and not just to a create', () => {
          // A patch that could only be spelled with a cast, or refused for a
          // reason the create path no longer has, would make the field
          // uneditable for exactly the text it was fine to save once.
          expect(validateCollectionPatch({ description: emoji(DESC_MAX) })).toEqual({ ok: true });
          expect(validateCollectionPatch({ description: emoji(DESC_MAX + 1) })).toEqual({
            ok: false,
            error: message,
          });
        });
      });

      describe('query', () => {
        const message = `query must be <= ${QUERY_MAX} characters`;

        it.each([
          [QUERY_MAX, true],
          [QUERY_MAX + 1, false],
        ])('verdict for %i ASCII characters: %s', (length, ok) => {
          const result = validateRetrieve({ query: 'q'.repeat(length) }, 'col-1');
          expect(result.ok).toBe(ok);
          if (!ok) {
            expect(result.error).toBe(message);
          }
        });

        it.each([
          [QUERY_MAX / 2, true],
          [QUERY_MAX / 2 + 1, true],
          [QUERY_MAX, true],
          [QUERY_MAX + 1, false],
        ])('verdict for %i emoji: %s', (count, ok) => {
          // 1,000 emoji is exactly the cap in code units and half of it in
          // characters, so 1,001 used to be the refusal. A query is the field
          // most likely to carry a pasted emoji or a non-Latin script, which is
          // exactly where a halved cap bites.
          const result = validateRetrieve({ query: emoji(count) }, 'col-1');
          expect(result.ok).toBe(ok);
          if (!ok) {
            expect(result.error).toBe(message);
          }
        });

        it('measures a mixed query by characters, where the two lengths disagree', () => {
          const mixed = emoji(1_100) + 'q';
          expect(mixed.length).toBe(2_201);
          expect([...mixed].length).toBe(1_101);
          expect(validateRetrieve({ query: mixed }, 'col-1')).toEqual({ ok: true });
        });

        it('still refuses a mixed query that is genuinely over the cap', () => {
          expect(validateRetrieve({ query: emoji(QUERY_MAX + 1) }, 'col-1')).toEqual({
            ok: false,
            error: message,
          });
        });

        it('reaches the route as a 400 with the same message', async () => {
          const { routes } = setup();
          const response = createResponse();

          await routes.retrieve(
            createRequest({
              body: { query: emoji(QUERY_MAX + 1) },
              params: { collectionId: 'col-1' },
            }),
            response,
          );

          expect(statusOf(response)).toBe(400);
          expect(bodyOf(response)).toEqual({ error: message });
        });

        it('lets a query of exactly the cap through to the route', async () => {
          // The boundary is inclusive, so this is not a 400 — it falls through
          // to the 404 for a collection that does not exist, which is the proof.
          const { routes } = setup();
          const response = createResponse();

          await routes.retrieve(
            createRequest({
              body: { query: emoji(QUERY_MAX) },
              params: { collectionId: 'col-1' },
            }),
            response,
          );

          expect(statusOf(response)).toBe(404);
        });
      });

      it('leaves every ASCII verdict exactly where it was', () => {
        // The direction that needed checking: code points are never fewer than
        // code units, so a cap measured in characters can only ever admit more
        // input. An ASCII document is one code point per character, so nothing
        // below the cap moved and nothing above it dropped in.
        expect(validateCreateCollection({ name: 'kb', description: 'd'.repeat(DESC_MAX) }).ok).toBe(
          true,
        );
        expect(
          validateCreateCollection({ name: 'kb', description: 'd'.repeat(DESC_MAX + 1) }).ok,
        ).toBe(false);
        expect(validateRetrieve({ query: 'q'.repeat(QUERY_MAX) }, 'col-1').ok).toBe(true);
        expect(validateRetrieve({ query: 'q'.repeat(QUERY_MAX + 1) }, 'col-1').ok).toBe(false);
      });
    });
  });

  /**
   * What a row written *before* the refusal does now that the type and the
   * validator both say the value does not exist. Narrowing a union deletes no
   * documents, and Mongo does not validate an enum on read, so a collection
   * stored as `project` by a deployment that ran the feature on an earlier
   * build is still in the database. These cases pin the answer rather than
   * leaving it to be discovered from a 404.
   *
   * The answer is that reads do not care: `canAccessCollection` is
   * owner-or-`global`, so a `project` row was always an owner-only collection
   * and still is. Nothing in the read path filters it, casts it away or drops
   * it — which is exactly why removing the value from the type was safe to do
   * without a migration.
   */
  describe('a collection stored with the retired project scope', () => {
    /** The type says this value cannot be sent; the database can still hold it. */
    const RETIRED = 'project' as unknown as CollectionScope;

    function seedLegacyProjectRow() {
      const harness = setup();
      const row: KnowledgeCollection = {
        id: 'legacy-1',
        userId: 'u-1',
        name: 'written before the refusal',
        scope: RETIRED,
        chunkSize: 800,
        chunkOverlap: 80,
        documentCount: 1,
        chunkCount: 3,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      };
      harness.rows.set(row.id, row);
      return harness;
    }

    it('reads back for its owner, with the stored scope intact', async () => {
      const { routes } = seedLegacyProjectRow();
      const response = createResponse();

      await routes.getCollection(
        createRequest({ params: { collectionId: 'legacy-1' }, user: USER }),
        response,
      );

      // Not narrowed on the way out: the value is not in the union, and quietly
      // rewriting it would be a data change disguised as a read.
      expect(statusOf(response)).toBe(200);
      expect(bodyOf(response)).toMatchObject({ collection: { scope: RETIRED } });
    });

    it('is visible to nobody else, because it always was an owner-only collection', async () => {
      const { routes } = seedLegacyProjectRow();
      const response = createResponse();

      await routes.getCollection(
        createRequest({ params: { collectionId: 'legacy-1' }, user: { id: 'u-2', role: 'USER' } }),
        response,
      );

      // 404, not 403: there is no project concept for the value to have leaked
      // into, which is the whole reason it was removed.
      expect(statusOf(response)).toBe(404);

      const listed = createResponse();
      await routes.listCollections(createRequest({ user: { id: 'u-2', role: 'USER' } }), listed);
      expect(bodyOf(listed)).toEqual({
        collections: [],
        total: 0,
        hasMore: false,
        capacity: null,
      });
    });

    it('cannot be re-sent, so the retired value cannot be spread any further', async () => {
      const { routes } = seedLegacyProjectRow();
      const response = createResponse();

      await routes.updateCollection(
        createRequest({
          body: rawBody({ scope: 'project' }),
          params: { collectionId: 'legacy-1' },
          user: USER,
        }),
        response,
      );

      expect(statusOf(response)).toBe(400);
      expect(bodyOf(response)).toEqual({ error: 'scope must be one of: private, global' });
    });

    it('is still editable and migratable, by patching it to a scope that exists', async () => {
      const { routes } = seedLegacyProjectRow();

      const renamed = createResponse();
      await routes.updateCollection(
        createRequest({
          body: { name: 'renamed' },
          params: { collectionId: 'legacy-1' },
          user: USER,
        }),
        renamed,
      );
      expect(statusOf(renamed)).toBe(200);

      // `canUseScope('private')` is true for every role, so retiring the value
      // is a one-way operation an owner can always perform. That is why no
      // migration is needed to clean these rows up.
      const migrated = createResponse();
      await routes.updateCollection(
        createRequest({
          body: { scope: 'private' },
          params: { collectionId: 'legacy-1' },
          user: USER,
        }),
        migrated,
      );

      expect(statusOf(migrated)).toBe(200);
      expect(bodyOf(migrated)).toMatchObject({
        collection: { scope: 'private', name: 'renamed' },
      });
    });
  });

  describe('validateAddDocument', () => {
    const BODY = { content: 'some text' };

    it('accepts a body with content and a route collectionId', () => {
      expect(validateAddDocument(BODY, 'col-1')).toEqual({ ok: true });
    });

    it.each([
      ['an empty', ''],
      ['a whitespace-only', '   '],
    ])('rejects %s route collectionId', (_label, collectionId) => {
      expect(validateAddDocument(BODY, collectionId)).toEqual({
        ok: false,
        error: 'collectionId is required',
      });
    });

    it('ignores a collectionId in the body: the route path is the only source', () => {
      expect(validateAddDocument({ ...BODY, collectionId: '' }, 'col-1')).toEqual({ ok: true });
    });

    it.each([
      ['absent', {}],
      ['empty', { content: '' }],
      ['whitespace only', { content: '  \n\t ' }],
      ['a non-string', { content: 12345 }],
    ])('rejects content that is %s', (_label, body) => {
      expect(validateAddDocument(body, 'col-1')).toEqual({
        ok: false,
        error: 'content is required',
      });
    });

    it('accepts content of exactly the cap', () => {
      expect(validateAddDocument({ content: 'a'.repeat(CONTENT_MAX) }, 'col-1')).toEqual({
        ok: true,
      });
    });

    it('rejects content one character over the cap', () => {
      expect(validateAddDocument({ content: 'a'.repeat(CONTENT_MAX + 1) }, 'col-1')).toEqual({
        ok: false,
        error: `content must be <= ${CONTENT_MAX} characters`,
      });
    });

    it('measures the cap after trimming, so padding cannot buy extra content', () => {
      expect(validateAddDocument({ content: `   ${'a'.repeat(CONTENT_MAX)}   ` }, 'col-1')).toEqual(
        { ok: true },
      );
    });
  });

  describe('validateRetrieve', () => {
    it('accepts a query and a route collectionId', () => {
      expect(validateRetrieve({ query: 'how do I deploy' }, 'col-1')).toEqual({ ok: true });
    });

    it.each([
      ['an empty', ''],
      ['a whitespace-only', '  '],
    ])('rejects %s route collectionId', (_label, collectionId) => {
      expect(validateRetrieve({ query: 'rag' }, collectionId)).toEqual({
        ok: false,
        error: 'collectionId is required',
      });
    });

    it.each([
      ['absent', {}],
      ['empty', { query: '' }],
      ['whitespace only', { query: '   ' }],
      ['a non-string', { query: null }],
    ])('rejects a query that is %s', (_label, body) => {
      expect(validateRetrieve(body, 'col-1')).toEqual({ ok: false, error: 'query is required' });
    });

    it('accepts a query of exactly the cap', () => {
      expect(validateRetrieve({ query: 'a'.repeat(QUERY_MAX) }, 'col-1')).toEqual({ ok: true });
    });

    it('rejects a query one character over the cap', () => {
      expect(validateRetrieve({ query: 'a'.repeat(QUERY_MAX + 1) }, 'col-1')).toEqual({
        ok: false,
        error: `query must be <= ${QUERY_MAX} characters`,
      });
    });
  });

  describe('validateCollectionPatch', () => {
    it('accepts an empty patch', () => {
      expect(validateCollectionPatch({})).toEqual({ ok: true });
    });

    it('accepts each field it does update', () => {
      expect(
        validateCollectionPatch({ name: 'renamed', description: 'team docs', scope: 'global' }),
      ).toEqual({ ok: true });
    });

    it('accepts a name of exactly the maximum length', () => {
      expect(validateCollectionPatch({ name: 'a'.repeat(NAME_MAX) })).toEqual({ ok: true });
    });

    it.each([
      ['empty', { name: '' }],
      ['whitespace only', { name: '  ' }],
      ['a non-string', { name: 42 }],
      ['one character over the maximum', { name: 'a'.repeat(NAME_MAX + 1) }],
    ])('rejects a name that is %s', (_label, body) => {
      expect(validateCollectionPatch(body)).toEqual({
        ok: false,
        error: `name must be 1..${NAME_MAX} characters`,
      });
    });

    it('does not validate the name when the patch carries none', () => {
      expect(validateCollectionPatch({ description: 'team docs' })).toEqual({ ok: true });
    });

    it('rejects a description one character over the maximum', () => {
      expect(validateCollectionPatch({ description: 'd'.repeat(DESC_MAX + 1) })).toEqual({
        ok: false,
        error: `description must be <= ${DESC_MAX} characters`,
      });
    });

    it('rejects an unknown scope', () => {
      expect(validateCollectionPatch({ scope: 'nonsense' })).toEqual({
        ok: false,
        error: 'scope must be one of: private, global',
      });
    });

    it('rejects a patch carrying chunk geometry, which the route then refuses', async () => {
      // Geometry is fixed at creation (`IKnowledgeCollection.chunkSize` says so).
      // `validateCollectionPatch` is a *field* validator and knows nothing about
      // that: `chunkOverlap: -1` is a well-formed value of a field this function
      // does not police, so it answers ok and the route is the layer that knows
      // a collection's geometry cannot move. Both halves are asserted, because
      // "accepted here, refused there" is only correct while each is where it is
      // — a validator that started policing it, or a route that started dropping
      // it again, would be a change of behaviour under a green test.
      expect(validateCollectionPatch({ chunkSize: 0, chunkOverlap: -1 })).toEqual({ ok: true });

      const { routes, knowledgeMethods } = setup();
      const created = createResponse();
      await routes.createCollection(
        createRequest({ body: { name: 'kb', chunkSize: 800, chunkOverlap: 80 } }),
        created,
      );
      const id = (bodyOf(created) as KnowledgeCollection).id;

      const patched = createResponse();
      await routes.updateCollection(
        createRequest({
          body: { chunkSize: 64, chunkOverlap: 8 },
          params: { collectionId: id },
          user: { id: '' },
        }),
        patched,
      );

      // The 400 `POST` gives for the same field. The alternative — 200 with the
      // collection unchanged — told the caller it had re-chunked a collection
      // whose documents are already stored at the old geometry.
      expect(statusOf(patched)).toBe(400);
      expect(bodyOf(patched)).toEqual({
        error:
          'chunkSize, chunkOverlap cannot be changed after a collection is created; ' +
          'a patch may only set name, description, scope',
      });
      expect(knowledgeMethods.updateKnowledgeCollection).not.toHaveBeenCalled();
    });
  });

  /**
   * The status half of the contract, and the whole of it. `routes.spec.ts`
   * already covers the 400 for a missing name, a bad scope, absent content and a
   * blank patch name; what is pinned here is that *every* message the validators
   * can produce — including the chunk geometry ones `routes.spec.ts` never
   * exercised — is a 400 with the validator's own text, and that none of them
   * reaches the store. A rejection that escaped as a 500 would page an operator
   * over a client typo.
   *
   * This table is the vocabulary, and it is complete by construction: every
   * rejection goes through a route, so a message that exists but is not a row
   * here is a message whose status nothing pins. A second table used to sit at
   * the end of this file listing the same fifteen strings and asserting that
   * `badRequest(message).status` was 400 — it called `errors.ts` directly, so it
   * could not fail for any change in `routes.ts`, `validation.ts` or
   * `handlers.ts`, and it went on passing while a message was reclassified. The
   * rows below are the ones that can.
   */
  describe('every rejection is a 400 { error } at the route', () => {
    const OVER_CAP = 'a'.repeat(CONTENT_MAX + 1);
    const AT_CAP = 'a'.repeat(CONTENT_MAX);
    const OVER_QUERY = 'a'.repeat(QUERY_MAX + 1);

    const REJECTIONS: {
      label: string;
      message: string;
      call: (routes: RagRoutes, response: Response) => Promise<unknown>;
    }[] = [
      {
        label: 'create: chunk size below the minimum',
        message: `chunkSize must be between ${CHUNK_SIZE_MIN} and ${CHUNK_SIZE_MAX}`,
        call: (routes, response) =>
          routes.createCollection(createRequest({ body: { name: 'kb', chunkSize: 15 } }), response),
      },
      {
        label: 'create: chunk size above the maximum',
        message: `chunkSize must be between ${CHUNK_SIZE_MIN} and ${CHUNK_SIZE_MAX}`,
        call: (routes, response) =>
          routes.createCollection(
            createRequest({ body: { name: 'kb', chunkSize: 8001 } }),
            response,
          ),
      },
      {
        label: 'create: chunk size that is not an integer',
        message: 'chunkSize must be an integer',
        call: (routes, response) =>
          routes.createCollection(
            createRequest({ body: rawBody({ name: 'kb', chunkSize: '800' }) }),
            response,
          ),
      },
      {
        label: 'create: negative overlap',
        message: 'chunkOverlap must be >= 0',
        call: (routes, response) =>
          routes.createCollection(
            createRequest({ body: { name: 'kb', chunkSize: 800, chunkOverlap: -1 } }),
            response,
          ),
      },
      {
        label: 'create: overlap not below the chunk size',
        message: 'chunkOverlap must be less than chunkSize',
        call: (routes, response) =>
          routes.createCollection(
            createRequest({ body: { name: 'kb', chunkSize: 800, chunkOverlap: 800 } }),
            response,
          ),
      },
      {
        label: 'create: missing name',
        message: 'name is required',
        call: (routes, response) =>
          routes.createCollection(createRequest({ body: { chunkSize: 800 } }), response),
      },
      {
        label: 'create: over-long name',
        message: `name must be <= ${NAME_MAX} characters`,
        call: (routes, response) =>
          routes.createCollection(
            createRequest({ body: { name: 'a'.repeat(NAME_MAX + 1) } }),
            response,
          ),
      },
      {
        label: 'addDocument: missing content',
        message: 'content is required',
        call: (routes, response) =>
          routes.addDocument(
            createRequest({ body: {}, params: { collectionId: 'col-1' } }),
            response,
          ),
      },
      {
        label: 'addDocument: content one character over the cap',
        message: `content must be <= ${CONTENT_MAX} characters`,
        call: (routes, response) =>
          routes.addDocument(
            createRequest({ body: { content: OVER_CAP }, params: { collectionId: 'col-1' } }),
            response,
          ),
      },
      {
        label: 'retrieve: missing query',
        message: 'query is required',
        call: (routes, response) =>
          routes.retrieve(createRequest({ body: {}, params: { collectionId: 'col-1' } }), response),
      },
      {
        label: 'retrieve: query one character over the cap',
        message: `query must be <= ${QUERY_MAX} characters`,
        call: (routes, response) =>
          routes.retrieve(
            createRequest({ body: { query: OVER_QUERY }, params: { collectionId: 'col-1' } }),
            response,
          ),
      },
      {
        label: 'update: blank name',
        message: `name must be 1..${NAME_MAX} characters`,
        call: (routes, response) =>
          routes.updateCollection(
            createRequest({ body: { name: '  ' }, params: { collectionId: 'col-1' } }),
            response,
          ),
      },
      {
        label: 'update: unknown scope',
        message: 'scope must be one of: private, global',
        call: (routes, response) =>
          routes.updateCollection(
            createRequest({
              body: rawBody({ scope: 'nope' }),
              params: { collectionId: 'col-1' },
            }),
            response,
          ),
      },
      {
        label: 'create: the unsupported project scope',
        message: 'scope must be one of: private, global',
        call: (routes, response) =>
          routes.createCollection(
            createRequest({ body: rawBody({ name: 'kb', scope: 'project' }) }),
            response,
          ),
      },
      {
        label: 'update: the unsupported project scope',
        message: 'scope must be one of: private, global',
        call: (routes, response) =>
          routes.updateCollection(
            createRequest({ body: rawBody({ scope: 'project' }), params: { collectionId: 'c' } }),
            response,
          ),
      },
      {
        label: 'create: an overlap that is not an integer',
        message: 'chunkOverlap must be an integer',
        call: (routes, response) =>
          routes.createCollection(
            createRequest({ body: rawBody({ name: 'kb', chunkOverlap: '80' }) }),
            response,
          ),
      },
      {
        label: 'create: an over-long description',
        message: `description must be <= ${DESC_MAX} characters`,
        call: (routes, response) =>
          routes.createCollection(
            createRequest({ body: { name: 'kb', description: 'a'.repeat(DESC_MAX + 1) } }),
            response,
          ),
      },
      {
        label: 'addDocument: a route path with no collectionId',
        message: 'collectionId is required',
        call: (routes, response) =>
          routes.addDocument(createRequest({ body: { content: 'text' }, params: {} }), response),
      },
      {
        label: 'retrieve: a route path with no collectionId',
        message: 'collectionId is required',
        call: (routes, response) =>
          routes.retrieve(createRequest({ body: { query: 'rag' }, params: {} }), response),
      },
      {
        label: 'create: an overlap the omitted chunk size could not support',
        message: 'chunkOverlap must be less than chunkSize',
        call: (routes, response) =>
          routes.createCollection(
            createRequest({ body: { name: 'kb', chunkOverlap: RAG_DEFAULTS.chunkSize } }),
            response,
          ),
      },
    ];

    it.each(REJECTIONS)('$label answers 400 { error }', async ({ message, call }) => {
      const { routes } = setup();
      const response = createResponse();

      await call(routes, response);

      expect(statusOf(response)).toBe(400);
      expect(bodyOf(response)).toEqual({ error: message });
    });

    it.each(REJECTIONS)('$label never reaches the store', async ({ call }) => {
      const { routes, knowledgeMethods } = setup();
      const response = createResponse();

      await call(routes, response);

      for (const method of Object.values(knowledgeMethods)) {
        expect(method).not.toHaveBeenCalled();
      }
    });

    it('accepts the two boundary requests the table above only rejects from one side', async () => {
      const { routes } = setup();
      const atCap = createResponse();
      const atQueryCap = createResponse();

      await routes.addDocument(
        createRequest({ body: { content: AT_CAP }, params: { collectionId: 'col-1' } }),
        atCap,
      );
      await routes.retrieve(
        createRequest({
          body: { query: 'a'.repeat(QUERY_MAX) },
          params: { collectionId: 'col-1' },
        }),
        atQueryCap,
      );

      // Not 400 — these fall through to a 404 for a collection that does not
      // exist, which is the point: the boundary is inclusive, so a document of
      // exactly the cap is ingested rather than refused.
      expect(statusOf(atCap)).not.toBe(400);
      expect(statusOf(atQueryCap)).not.toBe(400);
    });

    /**
     * Two scope failures that look alike in the message and are not alike in
     * kind, pinned side by side so a future refactor cannot merge them.
     *
     * `project` is not a scope this deployment has, so it is a 400 that no role
     * can turn into a success — a client retrying or escalating is wasting
     * everybody's time. `global` is a real scope with a real owner, refused only
     * because of who is asking, so it is a 403 from the service. Reporting
     * either as the other sends the caller down the wrong road: a 400 for `global`
     * reads as "fix the request" when the request is fine, and a 403 for
     * `project` invites a caller to believe an admin would be allowed to use it.
     */
    it('answers 400 for the unsupported project scope and 403 for global without the admin role', async () => {
      const { routes, knowledgeMethods } = setup();

      const project = createResponse();
      await routes.createCollection(
        createRequest({ body: rawBody({ name: 'kb', scope: 'project' }), user: USER }),
        project,
      );

      const global = createResponse();
      await routes.createCollection(
        createRequest({ body: { name: 'kb', scope: 'global' }, user: USER }),
        global,
      );

      expect(statusOf(project)).toBe(400);
      expect(bodyOf(project)).toEqual({ error: 'scope must be one of: private, global' });
      expect(statusOf(global)).toBe(403);
      expect(bodyOf(global)).toEqual({
        error: 'Collection scope not permitted: global requires the ADMIN role',
      });
      // Neither reached the store: a refusal of either kind writes nothing.
      for (const method of Object.values(knowledgeMethods)) {
        expect(method).not.toHaveBeenCalled();
      }
    });

    it('lets an admin create the global collection the previous request refused', async () => {
      const { routes } = setup();
      const response = createResponse();

      await routes.createCollection(
        createRequest({ body: { name: 'kb', scope: 'global' }, user: ADMIN }),
        response,
      );

      expect(statusOf(response)).toBe(201);
    });
  });
});
