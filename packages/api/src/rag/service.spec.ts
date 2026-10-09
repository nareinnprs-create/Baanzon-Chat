import { logger } from '@librechat/data-schemas';
import { SystemRoles } from 'librechat-data-provider';
import type {
  KnowledgeCollection,
  KnowledgeStore,
  CreateCollectionParams,
  RetrievedSnippet,
  RetrieveParams,
  VectorChunk,
} from './types';
import type { ChunkEmbedder, EmbedDegradation } from './embeddings';
import type { RagServiceDeps, SnippetReranker } from './service';
import type { RagActor } from './authorization';
import { createSemanticSearchService } from './semanticSearch';
import { validateCreateCollection } from './validation';
import { InMemoryVectorStore } from './vectorStores';
import { createRagService } from './service';
import { RAG_DEFAULTS } from './config';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const warn = jest.mocked(logger.warn);
const error = jest.mocked(logger.error);

const BASE_CONFIG = {
  chunkSize: 128,
  chunkOverlap: 12,
  hybridAlpha: 0.5,
  candidateK: 32,
  topK: 6,
  minScore: 0.1,
};

type Service = ReturnType<typeof createRagService>;

/** The two roles `canUseScope` distinguishes, and the absent case. */
const ADMIN: RagActor = { role: SystemRoles.ADMIN };
const USER: RagActor = { role: SystemRoles.USER };

interface Harness {
  service: Service;
  vectorStore: InMemoryVectorStore;
  collections: Map<string, KnowledgeCollection>;
}

/** Mirrors the Mongo methods: `global` is world-readable, writes stay with the owner. */
function makeStore(collections: Map<string, KnowledgeCollection>): KnowledgeStore {
  return {
    createCollection: async (collection) => {
      collections.set(collection.id, collection);
      return collection;
    },
    listCollections: async (userId) =>
      [...collections.values()].filter((c) => c.userId === userId || c.scope === 'global'),
    getCollection: async (userId, collectionId) => {
      const row = collections.get(collectionId);
      if (row == null) {
        return null;
      }
      return row.userId === userId || row.scope === 'global' ? row : null;
    },
    updateCollection: async (userId, collectionId, patch) => {
      const row = collections.get(collectionId);
      if (row == null || row.userId !== userId) {
        return null;
      }
      const next = { ...row, ...patch };
      collections.set(collectionId, next);
      return next;
    },
    /** Models Mongo's `$inc`: a single atomic read-modify-write, so a caller
     *  that instead wrote absolute values would be caught by the concurrency
     *  test below. */
    bumpCollectionStats: async (userId, collectionId, delta) => {
      const row = collections.get(collectionId);
      if (row == null || row.userId !== userId) {
        return null;
      }
      const next = {
        ...row,
        documentCount: row.documentCount + delta.documentDelta,
        chunkCount: row.chunkCount + delta.chunkDelta,
        updatedAt: new Date().toISOString(),
      };
      collections.set(collectionId, next);
      return next;
    },
    deleteCollection: async (userId, collectionId) => {
      const row = collections.get(collectionId);
      if (row == null || row.userId !== userId) {
        return false;
      }
      collections.delete(collectionId);
      return true;
    },
  };
}

function makeHarness(
  overrides: Partial<RagServiceDeps['config']> = {},
  semantic?: {
    search(collectionId: string, query: string, limit: number): Promise<VectorChunk[]>;
  },
  /** Passed in to model a process restart: the same durable metadata, a new index. */
  collections = new Map<string, KnowledgeCollection>(),
  /**
   * The remaining injections, in one bag rather than as two more positional
   * parameters. `vectorStore` is here so a test can stand up the store, hand it
   * to a semantic client, and then build the service over the *same* index — the
   * ingest and retrieval halves have to share one index for "the semantic branch
   * is joined" to mean anything.
   */
  extras: {
    embedder?: ChunkEmbedder;
    reranker?: SnippetReranker;
    vectorStore?: InMemoryVectorStore;
  } = {},
): Harness {
  const vectorStore = extras.vectorStore ?? new InMemoryVectorStore();
  const service = createRagService({
    config: { ...BASE_CONFIG, ...overrides },
    knowledgeStore: makeStore(collections),
    vectorStore,
    ...(semantic ? { semantic } : {}),
    ...(extras.embedder ? { embedder: extras.embedder } : {}),
    ...(extras.reranker ? { reranker: extras.reranker } : {}),
  });
  return { service, vectorStore, collections };
}

function chunkOf(
  collectionId: string,
  documentId: string,
  chunkIndex: number,
  text: string,
): VectorChunk {
  return { collectionId, documentId, chunkIndex, text };
}

/**
 * The same store as `makeHarness`, with every method spied, so a test can assert
 * that a refused call never reached the data layer — and not merely that it
 * returned, which a store that had already been written would also do.
 */
function makeSpiedHarness(overrides: Partial<RagServiceDeps['config']> = {}) {
  const collections = new Map<string, KnowledgeCollection>();
  const vectorStore = new InMemoryVectorStore();
  const store = makeStore(collections);
  const knowledgeStore = {
    createCollection: jest.fn(store.createCollection),
    getCollection: jest.fn(store.getCollection),
    listCollections: jest.fn(store.listCollections),
    updateCollection: jest.fn(store.updateCollection),
    bumpCollectionStats: jest.fn(store.bumpCollectionStats),
    deleteCollection: jest.fn(store.deleteCollection),
  };
  const service = createRagService({
    config: { ...BASE_CONFIG, ...overrides },
    knowledgeStore,
    vectorStore,
  });
  return { service, vectorStore, collections, knowledgeStore };
}

/** Nothing reached the data layer. */
function expectStoreUntouched(store: ReturnType<typeof makeSpiedHarness>['knowledgeStore']): void {
  for (const method of Object.values(store)) {
    expect(method).not.toHaveBeenCalled();
  }
}

/** `retrieve` answers `null` for an unreadable collection; every test below owns one. */
async function snippetsOf(service: Service, params: RetrieveParams): Promise<RetrievedSnippet[]> {
  const result = await service.retrieve(params);
  if (result == null) {
    throw new Error('expected snippets, got null');
  }
  return result;
}

/** Creates a collection and seeds one keyword-match and one keyword-miss chunk. */
async function seedTwoDocuments(harness: Harness): Promise<string> {
  const collection = await harness.service.createCollection({
    userId: 'u-1',
    name: 'docs',
    scope: 'private',
  });
  await harness.vectorStore.upsertChunks(collection.id, [
    chunkOf(collection.id, 'doc-a', 0, 'alpha beta'),
    chunkOf(collection.id, 'doc-b', 0, 'gamma delta'),
  ]);
  return collection.id;
}

describe('rag service retrieve', () => {
  describe('per-chunk retrieval (regression)', () => {
    it('returns one snippet per chunk of a multi-chunk document instead of collapsing the document into a single entry', async () => {
      const { service } = makeHarness({ minScore: 0, topK: 10 });
      const collection = await service.createCollection({
        userId: 'u-1',
        name: 'handbook',
        scope: 'private',
        chunkSize: 30,
        chunkOverlap: 0,
      });

      const added = await service.addDocument({
        userId: 'u-1',
        collectionId: collection.id,
        source: 'handbook.txt',
        content: 'rag'.repeat(40),
      });
      expect(added.chunkCount).toBeGreaterThanOrEqual(3);

      const snippets = await snippetsOf(service, {
        userId: 'u-1',
        collectionId: collection.id,
        query: 'rag',
        topK: 10,
      });

      expect(snippets).toHaveLength(added.chunkCount);
      expect(snippets.map((s) => s.chunkIndex).sort((a, b) => a - b)).toEqual(
        Array.from({ length: added.chunkCount }, (_unused, i) => i),
      );
      expect(new Set(snippets.map((s) => s.documentId))).toEqual(new Set([added.documentId]));
    });

    it('keeps chunks of two different documents in the same collection apart', async () => {
      const harness = makeHarness({ minScore: 0, topK: 10 });
      const collectionId = await seedTwoDocuments(harness);
      await harness.vectorStore.upsertChunk(
        collectionId,
        chunkOf(collectionId, 'doc-a', 1, 'rag delta'),
      );

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'rag',
      });

      expect(snippets.map((s) => `${s.documentId}:${s.chunkIndex}`).sort()).toEqual([
        'doc-a:0',
        'doc-a:1',
        'doc-b:0',
      ]);
    });

    it('regression: answers null instead of throwing for a collection owned by somebody else', async () => {
      const { service } = makeHarness();
      const collection = await service.createCollection({
        userId: 'u-1',
        name: 'private',
        scope: 'private',
      });

      const snippets = await service.retrieve({
        userId: 'u-2',
        collectionId: collection.id,
        query: 'rag',
      });

      expect(snippets).toBeNull();
    });

    it('answers null for a collection that does not exist', async () => {
      const { service } = makeHarness();

      expect(
        await service.retrieve({ userId: 'u-1', collectionId: 'missing', query: 'rag' }),
      ).toBeNull();
    });
  });

  describe('global scope authorization', () => {
    const seedGlobal = async (
      harness: Harness,
    ): Promise<{ collectionId: string; documentId: string }> => {
      /** An admin, because `global` is admin-only: the seeding is the
       *  privileged half of the rule, so it has to happen as a privileged
       *  caller for the read/write tests below to be about the *other*
       *  permissions and not about the scope gate refusing to open. */
      const collection = await harness.service.createCollection(
        {
          userId: 'u-1',
          name: 'shared',
          scope: 'global',
        },
        { role: SystemRoles.ADMIN },
      );
      const added = await harness.service.addDocument({
        userId: 'u-1',
        collectionId: collection.id,
        content: 'rag alpha beta gamma',
      });
      return { collectionId: collection.id, documentId: added.documentId };
    };

    it('lets a non-owner read the collection metadata', async () => {
      const harness = makeHarness();
      const { collectionId } = await seedGlobal(harness);

      expect(await harness.service.getCollection('u-2', collectionId)).not.toBeNull();
    });

    it('lets a non-owner retrieve from it', async () => {
      const harness = makeHarness();
      const { collectionId } = await seedGlobal(harness);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-2',
        collectionId,
        query: 'alpha',
      });

      expect(snippets.length).toBeGreaterThan(0);
    });

    it('refuses to let a non-owner delete the collection', async () => {
      const harness = makeHarness();
      const { collectionId } = await seedGlobal(harness);

      await expect(harness.service.deleteCollection('u-2', collectionId)).rejects.toMatchObject({
        status: 403,
      });
      expect(await harness.service.getCollection('u-1', collectionId)).not.toBeNull();
    });

    it('regression: a non-owner delete attempt leaves the vectors intact', async () => {
      const harness = makeHarness();
      const { collectionId } = await seedGlobal(harness);
      const before = await harness.vectorStore.semanticSearch(collectionId, 'alpha', 10);
      expect(before.length).toBeGreaterThan(0);

      await expect(harness.service.deleteCollection('u-2', collectionId)).rejects.toMatchObject({
        status: 403,
      });

      const after = await harness.vectorStore.semanticSearch(collectionId, 'alpha', 10);
      expect(after).toHaveLength(before.length);
    });

    it('refuses to let a non-owner delete a document in it', async () => {
      const harness = makeHarness();
      const { collectionId, documentId } = await seedGlobal(harness);

      await expect(
        harness.service.deleteDocument('u-2', collectionId, documentId),
      ).rejects.toMatchObject({ status: 403 });
      expect(await harness.vectorStore.semanticSearch(collectionId, 'alpha', 10)).not.toHaveLength(
        0,
      );
    });

    it('refuses to let a non-owner write a document into it', async () => {
      const harness = makeHarness();
      const { collectionId } = await seedGlobal(harness);
      const before = await harness.vectorStore.countChunks(collectionId);

      await expect(
        harness.service.addDocument({
          userId: 'u-2',
          collectionId,
          content: 'an injection attempt',
        }),
      ).rejects.toThrow('Access denied');
      expect(harness.collections.get(collectionId)?.documentCount).toBe(1);
      // Nothing reached the index either: the refusal is ahead of the write.
      expect(await harness.vectorStore.countChunks(collectionId)).toBe(before);
    });

    /**
     * One condition, one status, on all four write paths — the failure this block
     * exists to prevent is the reverse of it. A `global` collection the caller
     * may read but not write was 403 on `addDocument` and 404 on the other
     * three, because the three return `null`/`false` and had nowhere to put a
     * denial. They now resolve their target through one seam, so a client writes
     * one rule instead of three.
     *
     * A nonexistent id stays 404, which is asserted here as an equality against
     * the *shape* of each answer rather than by restating the numbers: a 403
     * discloses nothing, because `global` is world-readable and this caller was
     * handed the collection at 200 by `GET /:id` a moment earlier. What has to
     * hold is that nothing tells a caller whether a collection they cannot see
     * exists — so the absent column is compared field for field against the
     * foreign one and has to differ *only* in the 403.
     */
    it('answers a visible-but-not-owned collection with the same 403 on all four write paths', async () => {
      const harness = makeHarness();
      const { collectionId, documentId } = await seedGlobal(harness);

      /**
       * One shape for all four operations, so "the same status" is an equality
       * rather than four hand-matched expectations. The status is what the
       * handler turns the value into: `null`/`false` is 404, a thrown
       * `RagError` carries its own.
       */
      const outcome = async (collection: string, document: string) => {
        const { service } = harness;
        const settled = async (run: () => Promise<unknown>) => {
          try {
            return { ok: true, value: await run() };
          } catch (thrown) {
            const { status, message } = thrown as { status: number; message: string };
            return { ok: false, status, message };
          }
        };
        return {
          update: await settled(() =>
            service.updateCollection('u-2', collection, { name: 'hijacked' }, USER),
          ),
          deleteCollection: await settled(() => service.deleteCollection('u-2', collection)),
          deleteDocument: await settled(() => service.deleteDocument('u-2', collection, document)),
          addDocument: await settled(() =>
            service.addDocument({ userId: 'u-2', collectionId: collection, content: 'text' }),
          ),
        };
      };

      const foreign = await outcome(collectionId, documentId);
      const absent = await outcome('no-such-collection', 'no-such-document');

      // What every one of the four answers, on both kinds of collection.
      expect(foreign).toEqual({
        update: { ok: false, status: 403, message: 'Access denied' },
        deleteCollection: { ok: false, status: 403, message: 'Access denied' },
        deleteDocument: { ok: false, status: 403, message: 'Access denied' },
        addDocument: { ok: false, status: 403, message: 'Access denied' },
      });
      // A collection the caller cannot see is 404 on all four, so a 403 never
      // becomes a way to learn that a hidden one exists — and the message is the
      // handlers' generic one, which carries no information either way.
      expect(absent).toEqual({
        update: { ok: true, value: null },
        deleteCollection: { ok: true, value: false },
        deleteDocument: { ok: true, value: false },
        addDocument: { ok: false, status: 404, message: 'Collection not found' },
      });
      // The collection is still there, still readable, and untouched by any of it.
      expect(harness.collections.get(collectionId)?.name).toBe('shared');
      expect(await harness.service.getCollection('u-2', collectionId)).not.toBeNull();
    });

    it('never reaches the store with a write from a non-owner', async () => {
      // The four statuses are only worth anything if the refusal is ahead of the
      // write rather than compensating for it afterwards, so the store is spied
      // and the four are driven through it in one pass.
      const { service, collections, knowledgeStore } = makeSpiedHarness();
      const seeded = await service.createCollection(
        { userId: 'u-1', name: 'shared', scope: 'global' },
        { role: SystemRoles.ADMIN },
      );
      const refused = await Promise.all(
        [
          () => service.updateCollection('u-2', seeded.id, { name: 'hijacked' }),
          () => service.deleteCollection('u-2', seeded.id),
          () => service.deleteDocument('u-2', seeded.id, 'any-document'),
          () => service.addDocument({ userId: 'u-2', collectionId: seeded.id, content: 'text' }),
        ].map((run) =>
          run().then(
            () => null,
            (thrown: { status: number }) => thrown.status,
          ),
        ),
      );

      expect(refused).toEqual([403, 403, 403, 403]);
      // Only the seeding itself touched the store: no rename, no delete, no bump.
      for (const [name, method] of Object.entries(knowledgeStore)) {
        if (name === 'createCollection' || name === 'getCollection') {
          continue;
        }
        expect(method).not.toHaveBeenCalled();
      }
      expect(collections.get(seeded.id)).toMatchObject({ name: 'shared', documentCount: 0 });
    });

    it("answers an absent collection with 404, and another user's private one identically", async () => {
      // The half of the split that could have leaked. `global` is world-readable,
      // so a 403 for it says nothing; a `private` collection is not, so if the
      // two cases were answered differently a 403 would become a way to learn
      // that somebody else's private collection exists at all. They are driven
      // through the same four operations and have to come out identical.
      const harness = makeHarness();
      const { collectionId } = await seedGlobal(harness);
      const strangerPrivate = await harness.service.createCollection({
        userId: 'u-1',
        name: 'private',
      });
      await harness.service.addDocument({
        userId: 'u-1',
        collectionId: strangerPrivate.id,
        content: 'rag alpha beta gamma',
      });

      const outcome = async (id: string) => {
        const { service } = harness;
        const settled = async (run: () => Promise<unknown>) => {
          try {
            return { ok: true, value: await run() };
          } catch (thrown) {
            const { status, message } = thrown as { status: number; message: string };
            return { ok: false, status, message };
          }
        };
        return {
          update: await settled(() => service.updateCollection('u-2', id, { name: 'x' })),
          deleteCollection: await settled(() => service.deleteCollection('u-2', id)),
          deleteDocument: await settled(() => service.deleteDocument('u-2', id, 'any-document')),
          addDocument: await settled(() =>
            service.addDocument({ userId: 'u-2', collectionId: id, content: 'text' }),
          ),
        };
      };

      const absent = await outcome('no-such-collection');
      const hidden = await outcome(strangerPrivate.id);

      expect(hidden).toEqual(absent);
      expect(absent).toEqual({
        update: { ok: true, value: null },
        deleteCollection: { ok: true, value: false },
        deleteDocument: { ok: true, value: false },
        addDocument: { ok: false, status: 404, message: 'Collection not found' },
      });
      // And the shared one is not in that equivalence class, which is the whole
      // point of the split: the 403 is reserved for what the caller could see.
      expect((await outcome(collectionId)).addDocument).toMatchObject({ status: 403 });
      // Still there, in both cases.
      expect(harness.collections.get(collectionId)?.name).toBe('shared');
      expect(harness.collections.get(strangerPrivate.id)?.name).toBe('private');
    });

    it('refuses to let a non-owner update the collection', async () => {
      const harness = makeHarness();
      const { collectionId } = await seedGlobal(harness);

      await expect(
        harness.service.updateCollection('u-2', collectionId, { name: 'hijacked' }),
      ).rejects.toMatchObject({ status: 403 });
      expect(harness.collections.get(collectionId)?.name).toBe('shared');
    });

    it('lets the owner delete the global collection and its vectors', async () => {
      const harness = makeHarness();
      const { collectionId } = await seedGlobal(harness);

      expect(await harness.service.deleteCollection('u-1', collectionId)).toBe(true);
      expect(harness.collections.has(collectionId)).toBe(false);
      expect(await harness.vectorStore.semanticSearch(collectionId, 'alpha', 10)).toEqual([]);
    });
  });

  describe('createCollection scope validation', () => {
    it('rejects a scope outside the permitted set', async () => {
      const { service } = makeHarness();

      await expect(
        service.createCollection({
          userId: 'u-1',
          name: 'nope',
          scope: 'nonsense' as never,
        }),
      ).rejects.toThrow('Collection scope not permitted: nonsense');
    });

    it('rejects `project`, which no visibility rule ever honoured', async () => {
      // `canAccessCollection` is owner-or-`global`, so a `project` collection
      // is stored and read back exactly like a private one: a control that
      // silently does nothing. Accepting it here would let a direct service
      // caller mint the same phantom collection `validation.ts` now refuses.
      //
      // `as never` for the same reason as the case above: `CollectionScope` no
      // longer names the value, so passing it at all is the bypass this test
      // exists to close. An admin actor is supplied on purpose — the refusal
      // must not depend on who is asking.
      const project = 'project' as never;
      const { service } = makeHarness();

      await expect(
        service.createCollection({ userId: 'u-1', name: 'proj', scope: project }, ADMIN),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.createCollection({ userId: 'u-1', name: 'proj', scope: project }, ADMIN),
      ).rejects.toThrow('Collection scope not permitted: project');
    });

    it('accepts private for any caller, admin or not', async () => {
      const { service } = makeHarness();

      for (const actor of [ADMIN, USER, undefined]) {
        const collection = await service.createCollection(
          { userId: 'u-1', name: 'mine', scope: 'private' },
          actor,
        );
        expect(collection.scope).toBe('private');
      }
    });

    it('accepts global for an admin', async () => {
      const { service } = makeHarness();

      const collection = await service.createCollection(
        { userId: 'u-1', name: 'shared', scope: 'global' },
        ADMIN,
      );

      expect(collection.scope).toBe('global');
    });
  });

  /**
   * Chunk geometry is persisted with the collection and read by every later
   * ingest of it, so it is the one request field whose absence of validation
   * does not fail where it is written. `validateCreateCollection` catches it at
   * the route; the service catches it for every other caller, because the route
   * is one way in rather than the only one — the same defence-in-depth that put
   * `assertValidCollectionName` inside `createCollection`.
   */
  describe('createCollection chunk geometry', () => {
    /**
     * The failures this closes, with the message each one produces. The messages
     * are `validation.ts`'s verbatim, and the last test pins that they still are
     * — two copies of one rule in two modules is only safe while something fails
     * when they drift.
     */
    const BAD_GEOMETRY: Array<[label: string, geometry: Record<string, unknown>, error: string]> = [
      ['a zero size', { chunkSize: 0, chunkOverlap: 0 }, 'chunkSize must be between 16 and 8000'],
      [
        'a negative size',
        { chunkSize: -100, chunkOverlap: 0 },
        'chunkSize must be between 16 and 8000',
      ],
      [
        'a size one below the minimum',
        { chunkSize: 15, chunkOverlap: 0 },
        'chunkSize must be between 16 and 8000',
      ],
      [
        'a size one above the maximum',
        { chunkSize: 8_001, chunkOverlap: 0 },
        'chunkSize must be between 16 and 8000',
      ],
      ['a fractional size', { chunkSize: 800.5, chunkOverlap: 0 }, 'chunkSize must be an integer'],
      ['a size that is not a number', { chunkSize: '800' }, 'chunkSize must be an integer'],
      ['NaN', { chunkSize: Number.NaN }, 'chunkSize must be an integer'],
      ['Infinity', { chunkSize: Number.POSITIVE_INFINITY }, 'chunkSize must be an integer'],
      ['a negative overlap', { chunkSize: 200, chunkOverlap: -1 }, 'chunkOverlap must be >= 0'],
      [
        'a fractional overlap',
        { chunkSize: 200, chunkOverlap: 1.5 },
        'chunkOverlap must be an integer',
      ],
      [
        'an overlap equal to the size',
        { chunkSize: 200, chunkOverlap: 200 },
        'chunkOverlap must be less than chunkSize',
      ],
      [
        'an overlap above the size',
        { chunkSize: 200, chunkOverlap: 1_000_000 },
        'chunkOverlap must be less than chunkSize',
      ],
      [
        // The request's own geometry is coherent; the *configured* size it will
        // be stored against is not, and `validation.ts` compares against the
        // resolved config precisely so this cannot slip through on an omitted
        // size. `BASE_CONFIG.chunkSize` is 128.
        'an overlap above the size the config will store',
        { chunkOverlap: 129 },
        'chunkOverlap must be less than chunkSize',
      ],
    ];

    it.each(BAD_GEOMETRY)(
      'refuses %s with a typed 400, before the store is touched',
      async (_label, geometry, error) => {
        const { service, collections, knowledgeStore } = makeSpiedHarness();

        await expect(
          service.createCollection({
            userId: 'u-1',
            name: 'docs',
            ...geometry,
          } as CreateCollectionParams),
        ).rejects.toMatchObject({ status: 400 });
        await expect(
          service.createCollection({
            userId: 'u-1',
            name: 'docs',
            ...geometry,
          } as CreateCollectionParams),
        ).rejects.toThrow(error);

        // The whole point of the status: a typed 400, so a caller is told to fix
        // the geometry rather than that the server is broken. Before this, the
        // value was accepted and every later ingest of the collection failed at
        // `chunkText` with a bare 500.
        expect(collections.size).toBe(0);
        expectStoreUntouched(knowledgeStore);
      },
    );

    it('refuses a size the config will store and the request omits, so the pair is judged as one', async () => {
      // The deployment configured a size the request never mentions. The stored
      // size is the configured one, so the overlap has to be checked against
      // that number and not against a size this request happened to carry.
      const { service, collections, knowledgeStore } = makeSpiedHarness({ chunkSize: 64 });

      await expect(
        service.createCollection({ userId: 'u-1', name: 'docs', chunkOverlap: 64 }),
      ).rejects.toMatchObject({ status: 400 });
      expect(collections.size).toBe(0);
      expectStoreUntouched(knowledgeStore);
    });

    it('stores a valid geometry and reports the numbers it stored', async () => {
      const { service, collections } = makeSpiedHarness();

      const collection = await service.createCollection({
        userId: 'u-1',
        name: 'docs',
        chunkSize: 200,
        chunkOverlap: 20,
      });

      expect(collection).toMatchObject({ chunkSize: 200, chunkOverlap: 20 });
      expect(collections.get(collection.id)).toMatchObject({ chunkSize: 200, chunkOverlap: 20 });
    });

    it('falls back to the configured geometry, which is validated too', async () => {
      const { service, collections } = makeSpiedHarness({ chunkSize: 200, chunkOverlap: 20 });

      const collection = await service.createCollection({ userId: 'u-1', name: 'docs' });

      expect(collections.get(collection.id)).toMatchObject({ chunkSize: 200, chunkOverlap: 20 });
      expect(collection.chunkOverlap).toBe(20);
    });

    /**
     * The end the whole check exists for: a collection created by a direct call —
     * no route, no validator — with geometry that passes, ingests afterwards.
     */
    it('lets a collection created directly with valid geometry ingest afterwards', async () => {
      const harness = makeHarness();

      const collection = await harness.service.createCollection({
        userId: 'u-1',
        name: 'docs',
        chunkSize: 40,
        chunkOverlap: 8,
      });
      const added = await harness.service.addDocument({
        userId: 'u-1',
        collectionId: collection.id,
        content: 'rag alpha beta gamma delta epsilon zeta eta theta',
      });

      expect(added.chunkCount).toBeGreaterThan(1);
      expect(await harness.vectorStore.countChunks(collection.id)).toBe(added.chunkCount);
      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId: collection.id,
        query: 'gamma',
      });
      expect(snippets.length).toBeGreaterThan(0);
    });

    /**
     * The route keeps its early validation, and the service is the backstop, so
     * the two have to reach the same verdict — including the exact message, since
     * a request that somehow reached the service instead of the route would
     * otherwise be told a different thing about the same numbers.
     *
     * `BASE_CONFIG.chunkSize` is handed to the validator as the resolved config
     * so both sides judge the omitted-size cases against the same 128.
     */
    it.each([
      ...BAD_GEOMETRY,
      ['a valid pair', { chunkSize: 200, chunkOverlap: 20 }, undefined],
      ['the minimum size', { chunkSize: 16, chunkOverlap: 15 }, undefined],
      ['no overlap', { chunkSize: 200, chunkOverlap: 0 }, undefined],
      ['the whole deployment default', {}, undefined],
    ] as Array<[string, Record<string, unknown>, string | undefined]>)(
      'agrees with validateCreateCollection on %s',
      async (_label, geometry, error) => {
        const verdict = validateCreateCollection(
          { name: 'docs', ...geometry },
          { chunkSize: BASE_CONFIG.chunkSize },
        );
        const { service } = makeSpiedHarness();
        const accepted = await service
          .createCollection({ userId: 'u-1', name: 'docs', ...geometry } as CreateCollectionParams)
          .then(
            () => null,
            (thrown: { status: number; message: string }) => thrown,
          );

        if (verdict.ok) {
          expect(accepted).toBeNull();
        } else {
          expect(accepted).toMatchObject({ status: 400, message: verdict.error });
          expect(accepted?.message).toBe(error);
        }
      },
    );
  });

  /**
   * The deployment's own geometry reaches the service with no request attached,
   * so a value `ragSchema` would have refused is only reachable through a
   * hand-wired config. It is checked anyway, because a collection whose stored
   * size cannot chunk is un-ingestable for good and the two numbers that cause
   * that are the only ones this service has to be sure about.
   */
  describe('a config the deployment could not express', () => {
    it('replaces a size that cannot chunk, so every collection it stores can ingest', async () => {
      error.mockClear();
      const { service } = makeSpiedHarness({ chunkSize: 0, chunkOverlap: 12 });

      const collection = await service.createCollection({ userId: 'u-1', name: 'docs' });

      expect(collection.chunkSize).toBe(RAG_DEFAULTS.chunkSize);
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toContain('chunkSize 0 -> 800');
    });

    it('replaces a size that is not a number at all', async () => {
      error.mockClear();
      const { service } = makeSpiedHarness({
        chunkSize: Number.NaN,
        chunkOverlap: Number.NaN,
      });

      const collection = await service.createCollection({ userId: 'u-1', name: 'docs' });

      // A `NaN` overlap makes `chunkText`'s resume arithmetic meaningless, so
      // neither number is stored as it was configured.
      expect(collection).toMatchObject({
        chunkSize: RAG_DEFAULTS.chunkSize,
        chunkOverlap: 0,
      });
      expect(error.mock.calls[0][0]).toContain('chunkOverlap NaN -> 0');
    });

    it('lets the collection it stores ingest, rather than failing at every document', async () => {
      // The size the config asked for could not chunk, so the stored one is the
      // deployment default — which is why this document is one chunk rather than
      // the several a 20-character size would have produced.
      const harness = makeHarness({ chunkSize: 0, chunkOverlap: 12 });

      const collection = await harness.service.createCollection({ userId: 'u-1', name: 'docs' });
      const added = await harness.service.addDocument({
        userId: 'u-1',
        collectionId: collection.id,
        content: 'rag alpha beta gamma delta epsilon zeta eta theta',
      });

      expect(added.chunkCount).toBeGreaterThan(0);
      expect(await harness.vectorStore.countChunks(collection.id)).toBe(added.chunkCount);
    });

    it('reports a configured pair that disagrees, naming the overlap ingest will use', async () => {
      // The pair is left stored as configured — such a collection still ingests,
      // because the chunker caps any overlap at `floor(chunkSize / 2)` — so this
      // line is the only place the operator learns that the stored number is not
      // the one that will be applied. `ragSchema` is where it would be refused
      // outright; until then it is reported, once per service.
      error.mockClear();
      makeSpiedHarness({ chunkSize: 200, chunkOverlap: 100_000 });

      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toContain('chunkOverlap 100000 is not below chunkSize 200');
      expect(error.mock.calls[0][0]).toContain('collections store the 100 the chunker will apply');
    });

    it('says nothing for a coherent pair, since there is nothing to report', async () => {
      error.mockClear();
      makeSpiedHarness({ chunkSize: 200, chunkOverlap: 100 });

      expect(error).not.toHaveBeenCalled();
    });
  });

  /**
   * `global` hands a collection to every member of the tenant, so creating or
   * promoting one is a decision about other people's access and only an admin
   * may make it. Enforced in the service rather than the route, so calling it
   * directly cannot get around the rule — which is what the `undefined`-actor
   * cases below are for.
   */
  describe('`global` is admin-only', () => {
    it('refuses a create with scope global from a non-admin, as 403', async () => {
      const { service, collections, knowledgeStore } = makeSpiedHarness();

      await expect(
        service.createCollection({ userId: 'u-1', name: 'shared', scope: 'global' }, USER),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.createCollection({ userId: 'u-1', name: 'shared', scope: 'global' }, USER),
      ).rejects.toThrow('Collection scope not permitted: global requires the ADMIN role');

      expect(collections.size).toBe(0);
      expectStoreUntouched(knowledgeStore);
    });

    it('refuses a create with scope global from a caller that supplies no role', async () => {
      // The route builds the actor from `req.user`, so a direct service call is
      // the case where a missing role has to mean "not an admin" rather than
      // "unconstrained" — otherwise the domain layer would be the one hole in
      // a rule it is supposed to own.
      const { service, knowledgeStore } = makeSpiedHarness();

      await expect(
        service.createCollection({ userId: 'u-1', name: 'shared', scope: 'global' }),
      ).rejects.toMatchObject({ status: 403 });
      expectStoreUntouched(knowledgeStore);
    });

    it('defaults to private when the scope is omitted, so no role is needed', async () => {
      const { service } = makeSpiedHarness();

      const collection = await service.createCollection({ userId: 'u-1', name: 'mine' });

      expect(collection.scope).toBe('private');
    });

    it('lets an admin create a global collection', async () => {
      const { service, collections } = makeSpiedHarness();

      const collection = await service.createCollection(
        { userId: 'admin-1', name: 'handbook', scope: 'global' },
        ADMIN,
      );

      expect(collection.scope).toBe('global');
      expect(collections.get(collection.id)?.scope).toBe('global');
    });

    it('refuses a promotion of an owned private collection to global, as 403', async () => {
      const { service, collections, knowledgeStore } = makeSpiedHarness();
      const owned = await service.createCollection(
        { userId: 'u-1', name: 'mine', scope: 'private' },
        USER,
      );
      knowledgeStore.updateCollection.mockClear();

      await expect(
        service.updateCollection('u-1', owned.id, { scope: 'global' }, USER),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.updateCollection('u-1', owned.id, { scope: 'global' }, USER),
      ).rejects.toThrow('Collection scope not permitted: global requires the ADMIN role');

      expect(collections.get(owned.id)?.scope).toBe('private');
      expect(knowledgeStore.updateCollection).not.toHaveBeenCalled();
    });

    it('refuses a promotion from a caller that supplies no role', async () => {
      const { service, knowledgeStore } = makeSpiedHarness();
      const owned = await service.createCollection({ userId: 'u-1', name: 'mine' });
      knowledgeStore.updateCollection.mockClear();

      await expect(
        service.updateCollection('u-1', owned.id, { scope: 'global' }),
      ).rejects.toMatchObject({ status: 403 });

      expect(knowledgeStore.updateCollection).not.toHaveBeenCalled();
    });

    it('lets an admin promote an owned private collection to global', async () => {
      const { service, collections } = makeSpiedHarness();
      const owned = await service.createCollection({ userId: 'u-1', name: 'mine' });

      const updated = await service.updateCollection('u-1', owned.id, { scope: 'global' }, ADMIN);

      expect(updated?.scope).toBe('global');
      expect(collections.get(owned.id)?.scope).toBe('global');
    });

    /**
     * The other direction, and the one that genuinely differs: narrowing is not
     * a grant, so `canUseScope` permits `private` for every role. It has to
     * stay available — an admin's `global` collection whose owner later loses
     * the role would otherwise be stuck shared forever, un-unshareable by the
     * only person entitled to fix it.
     */
    it('lets a non-admin owner unshare their own global collection back to private', async () => {
      const { service, collections } = makeSpiedHarness();
      const shared = await service.createCollection(
        { userId: 'u-1', name: 'shared', scope: 'global' },
        ADMIN,
      );

      // The owner is no longer an admin — the state a role change leaves behind.
      const updated = await service.updateCollection('u-1', shared.id, { scope: 'private' }, USER);

      expect(updated?.scope).toBe('private');
      expect(collections.get(shared.id)?.scope).toBe('private');
    });

    it('leaves a non-admin unable to reach global by patching a name alongside the scope', async () => {
      // The gate reads `patch.scope`, not the shape of the patch, so bundling a
      // permitted field with the forbidden one is still refused.
      const { service, collections } = makeSpiedHarness();
      const owned = await service.createCollection({ userId: 'u-1', name: 'mine' });

      await expect(
        service.updateCollection('u-1', owned.id, { name: 'renamed', scope: 'global' }, USER),
      ).rejects.toMatchObject({ status: 403 });

      expect(collections.get(owned.id)).toMatchObject({ name: 'mine', scope: 'private' });
    });

    it('answers a non-owner patching a global collection with 403, before the scope gate', async () => {
      // The ownership check runs first, so a non-owner is told they may not write
      // rather than being walked into the scope gate and told their *role* is the
      // problem — which for a `global` collection they can already read at 200
      // would be the more confusing of the two true things. The store is spied
      // so the answer is known to be a refusal rather than a filtered write.
      const { service, knowledgeStore } = makeSpiedHarness();
      const shared = await service.createCollection(
        { userId: 'u-1', name: 'shared', scope: 'global' },
        ADMIN,
      );
      knowledgeStore.updateCollection.mockClear();

      await expect(
        service.updateCollection('u-2', shared.id, { scope: 'global' }, USER),
      ).rejects.toMatchObject({ status: 403 });
      expect(knowledgeStore.updateCollection).not.toHaveBeenCalled();
    });

    /**
     * The over-blocking half. `private` is the default scope and the ordinary
     * case, so the whole lifecycle has to keep working for a plain user — and
     * for a direct caller that supplies no role at all.
     */
    it.each([
      ['a plain user', USER],
      ['a caller with no role', undefined],
    ])('leaves %s free to run a private collection end to end', async (_label, actor) => {
      const { service, collections, vectorStore } = makeSpiedHarness({ minScore: 0 });

      const created = await service.createCollection(
        { userId: 'u-1', name: 'mine', scope: 'private' },
        actor,
      );
      expect(created.scope).toBe('private');

      expect(await service.getCollection('u-1', created.id)).not.toBeNull();
      expect((await service.listCollections('u-1')).collections).toHaveLength(1);

      const added = await service.addDocument({
        userId: 'u-1',
        collectionId: created.id,
        content: 'rag alpha beta gamma',
      });
      expect(added.chunkCount).toBeGreaterThan(0);

      const snippets = await snippetsOf(service, {
        userId: 'u-1',
        collectionId: created.id,
        query: 'alpha',
      });
      expect(snippets.length).toBeGreaterThan(0);

      const updated = await service.updateCollection(
        'u-1',
        created.id,
        { name: 'renamed', description: 'still mine' },
        actor,
      );
      expect(updated).toMatchObject({ name: 'renamed', description: 'still mine' });

      expect(await service.deleteDocument('u-1', created.id, added.documentId)).toBe(true);
      expect(await service.deleteCollection('u-1', created.id)).toBe(true);
      expect(collections.has(created.id)).toBe(false);
      expect(await vectorStore.semanticSearch(created.id, 'alpha', 10)).toEqual([]);
    });
  });

  /**
   * The listing is a page plus the count it is measured against, and the whole
   * point of the count is the case a page cannot describe: a caller with more
   * collections than the page holds received a list that looked complete, and
   * a header count derived from its length read as the whole truth.
   */
  describe('listCollections', () => {
    /**
     * A store whose page stops at `pageSize` while the caller owns more, which
     * is what the real store does at its own cap. `countCollections` is the
     * uncapped number beside it.
     */
    function makeCappedHarness(owned: number, pageSize: number, { count = true } = {}) {
      const collections = new Map<string, KnowledgeCollection>();
      const store = makeStore(collections);
      const page = store.listCollections;
      const service = createRagService({
        config: BASE_CONFIG,
        knowledgeStore: {
          ...store,
          listCollections: async (userId: string) => (await page(userId)).slice(0, pageSize),
        },
        vectorStore: new InMemoryVectorStore(),
        ...(count ? { countCollections: async () => owned } : {}),
      });
      for (let index = 0; index < owned; index += 1) {
        collections.set(`col-${index}`, {
          id: `col-${index}`,
          userId: 'u-1',
          name: `collection ${index}`,
          scope: 'private',
          chunkSize: 128,
          chunkOverlap: 12,
          documentCount: 0,
          chunkCount: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        });
      }
      return { service, collections };
    }

    it('reports the total the caller can see, not the length of the page', async () => {
      const { service } = makeCappedHarness(250, 200);

      const listing = await service.listCollections('u-1');

      expect(listing.collections).toHaveLength(200);
      expect(listing.total).toBe(250);
      // The sentence a client can now write: "showing 200 of 250".
      expect(listing.hasMore).toBe(true);
    });

    it('reports no more when the page holds everything', async () => {
      const { service } = makeCappedHarness(3, 200);

      const listing = await service.listCollections('u-1');

      expect(listing.total).toBe(3);
      expect(listing.hasMore).toBe(false);
    });

    it('says zero for a caller with nothing, so "none" is never inferred from a full page', async () => {
      const { service } = makeCappedHarness(0, 200);

      const listing = await service.listCollections('u-1');

      expect(listing.collections).toEqual([]);
      expect(listing.total).toBe(0);
      expect(listing.hasMore).toBe(false);
    });

    it('degrades to the pre-existing meaning when the store cannot count', async () => {
      // No `countCollections` wired: the page is reported as the whole list,
      // which is exactly what the response claimed before `total` existed — an
      // older answer rather than a wrong one.
      const { service } = makeCappedHarness(250, 200, { count: false });

      const listing = await service.listCollections('u-1');

      expect(listing.collections).toHaveLength(200);
      expect(listing.total).toBe(200);
      expect(listing.hasMore).toBe(false);
    });
  });

  describe('listCollections capacity', () => {
    /**
     * The store that reports its own headroom, which is the one whose 409 is
     * about to fire. A store that does not implement `capacity` is absent from
     * the interface, so these run against an explicitly shaped double rather
     * than against `InMemoryVectorStore`.
     */
    function makeHarnessReportingCapacity(capacity: {
      remainingChunks: number | null;
      remainingCollections: number | null;
    }) {
      const service = createRagService({
        config: BASE_CONFIG,
        knowledgeStore: makeStore(new Map()),
        vectorStore: {
          countChunks: async () => 0,
          upsertChunk: async () => undefined,
          upsertChunks: async () => undefined,
          semanticSearch: async () => [],
          deleteDocument: async () => 0,
          deleteCollection: async () => undefined,
          capacity: () => capacity,
        },
      });
      return service;
    }

    it('reports what the store says it can still accept', async () => {
      const service = makeHarnessReportingCapacity({
        remainingChunks: 11_420,
        remainingCollections: 137,
      });

      expect((await service.listCollections('u-1')).capacity).toEqual({
        remainingChunks: 11_420,
        remainingCollections: 137,
      });
    });

    it('passes an unbounded store through as nulls rather than zeroes', async () => {
      // Zero would read as a store that refuses everything, and this one
      // accepts everything; a client told "0 remaining" would tell the user the
      // wrong thing about their own deployment.
      const service = makeHarnessReportingCapacity({
        remainingChunks: null,
        remainingCollections: null,
      });

      expect((await service.listCollections('u-1')).capacity).toEqual({
        remainingChunks: null,
        remainingCollections: null,
      });
    });

    it('reports null capacity for a store that does not say', async () => {
      const { service } = makeHarness();

      // Not `0`: "this deployment reports nothing" and "this deployment is
      // full" are different sentences, and only the second one is true of a
      // fresh process.
      expect((await service.listCollections('u-1')).capacity).toBeNull();
    });
  });

  describe('deleteDocument', () => {
    it('reports success and decrements both counters by the chunks it removed', async () => {
      const harness = makeHarness();
      const collection = await harness.service.createCollection({
        userId: 'u-1',
        name: 'docs',
        scope: 'private',
        chunkSize: 20,
        chunkOverlap: 0,
      });
      const added = await harness.service.addDocument({
        userId: 'u-1',
        collectionId: collection.id,
        content: 'rag alpha beta gamma delta epsilon zeta eta theta',
      });
      expect(added.chunkCount).toBeGreaterThan(1);
      const before = await harness.service.getCollection('u-1', collection.id);
      expect(before?.documentCount).toBe(1);
      expect(before?.chunkCount).toBe(added.chunkCount);

      const deleted = await harness.service.deleteDocument('u-1', collection.id, added.documentId);

      expect(deleted).toBe(true);
      const after = await harness.service.getCollection('u-1', collection.id);
      expect(after?.documentCount).toBe(0);
      expect(after?.chunkCount).toBe(0);
      expect(await harness.vectorStore.semanticSearch(collection.id, 'alpha', 10)).toHaveLength(0);
    });

    it('keeps every increment when documents are ingested concurrently', async () => {
      const harness = makeHarness();
      const collection = await harness.service.createCollection({
        userId: 'u-1',
        name: 'concurrent',
        chunkSize: 20,
        chunkOverlap: 0,
      });

      const added = await Promise.all(
        ['alpha bravo', 'charlie delta', 'echo foxtrot'].map((content) =>
          harness.service.addDocument({ userId: 'u-1', collectionId: collection.id, content }),
        ),
      );

      const chunks = added.reduce((sum, doc) => sum + doc.chunkCount, 0);
      const after = await harness.service.getCollection('u-1', collection.id);
      expect(after?.documentCount).toBe(3);
      expect(after?.chunkCount).toBe(chunks);
    });

    it('reports a missing document and leaves both counters untouched', async () => {
      const harness = makeHarness();
      const collection = await harness.service.createCollection({
        userId: 'u-1',
        name: 'docs',
        scope: 'private',
        chunkSize: 20,
        chunkOverlap: 0,
      });
      const added = await harness.service.addDocument({
        userId: 'u-1',
        collectionId: collection.id,
        content: 'rag alpha beta gamma delta epsilon zeta eta theta',
      });
      const before = await harness.service.getCollection('u-1', collection.id);

      const deleted = await harness.service.deleteDocument(
        'u-1',
        collection.id,
        'doc-does-not-exist',
      );

      expect(deleted).toBe(false);
      const after = await harness.service.getCollection('u-1', collection.id);
      expect(after?.documentCount).toBe(1);
      expect(after?.chunkCount).toBe(added.chunkCount);
      expect(after?.chunkCount).toBe(before?.chunkCount);
    });

    it('reports false on a second delete of the same document', async () => {
      const harness = makeHarness();
      const collection = await harness.service.createCollection({
        userId: 'u-1',
        name: 'docs',
        scope: 'private',
      });
      const added = await harness.service.addDocument({
        userId: 'u-1',
        collectionId: collection.id,
        content: 'rag alpha beta',
      });

      expect(await harness.service.deleteDocument('u-1', collection.id, added.documentId)).toBe(
        true,
      );
      expect(await harness.service.deleteDocument('u-1', collection.id, added.documentId)).toBe(
        false,
      );
    });

    it('reports false for a document in an unknown collection', async () => {
      const harness = makeHarness();

      expect(await harness.service.deleteDocument('u-1', 'missing', 'doc-1')).toBe(false);
    });

    it('refuses to delete from a collection owned by somebody else', async () => {
      const harness = makeHarness();
      const collection = await harness.service.createCollection({
        userId: 'u-1',
        name: 'docs',
        scope: 'private',
      });

      expect(await harness.service.deleteDocument('u-2', collection.id, 'doc-1')).toBe(false);
    });
  });

  /**
   * The ledger is durable and the index is not, so a process restart leaves the
   * two describing different things. These tests pin what a caller is told
   * afterwards: the count the index can actually serve, and a log line when a
   * write finds the gap.
   */
  describe('counter honesty across a process restart', () => {
    const LONG_DOC = 'rag alpha beta gamma delta epsilon zeta eta theta';

    const ingest = async (
      harness: Harness,
    ): Promise<{ collectionId: string; chunkCount: number }> => {
      const collection = await harness.service.createCollection({
        userId: 'u-1',
        name: 'docs',
        scope: 'private',
        chunkSize: 20,
        chunkOverlap: 0,
      });
      const added = await harness.service.addDocument({
        userId: 'u-1',
        collectionId: collection.id,
        content: LONG_DOC,
      });
      return { collectionId: collection.id, chunkCount: added.chunkCount };
    };

    /** A restart keeps the metadata store and replaces the index with an empty one. */
    const restart = (harness: Harness): Harness => makeHarness({}, undefined, harness.collections);

    it('reports the stored chunk count rather than the ledger after the index is lost', async () => {
      const before = makeHarness();
      const { collectionId, chunkCount } = await ingest(before);
      expect(chunkCount).toBeGreaterThan(1);

      const after = await restart(before).service.getCollection('u-1', collectionId);

      expect(after?.chunkCount).toBe(0);
      // `documentCount` has no store-side counterpart, so the ledger value
      // stands: it is the one count nothing can recount.
      expect(after?.documentCount).toBe(1);
      // The ledger itself is untouched — the overlay is a read, not a repair.
      expect(before.collections.get(collectionId)?.chunkCount).toBe(chunkCount);
    });

    it('reports the same honest count from listCollections', async () => {
      const before = makeHarness();
      const { collectionId, chunkCount } = await ingest(before);

      const listed = await restart(before).service.listCollections('u-1');

      expect(listed.collections.map((c) => [c.id, c.chunkCount])).toEqual([[collectionId, 0]]);
      expect(before.collections.get(collectionId)?.chunkCount).toBe(chunkCount);
    });

    it('agrees with what retrieve can actually return', async () => {
      const before = makeHarness();
      const { collectionId } = await ingest(before);
      const after = restart(before);

      expect(
        await snippetsOf(after.service, { userId: 'u-1', collectionId, query: 'alpha' }),
      ).toEqual([]);
      expect((await after.service.getCollection('u-1', collectionId))?.chunkCount).toBe(0);
    });

    it('warns when a write finds the ledger and the index disagree', async () => {
      const before = makeHarness();
      const { collectionId } = await ingest(before);
      const after = restart(before);
      warn.mockClear();

      await after.service.addDocument({
        userId: 'u-1',
        collectionId,
        content: 'a fresh document after the restart',
      });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('chunk-count drift');
    });

    it('stays quiet while the ledger and the index agree', async () => {
      const harness = makeHarness();
      const { collectionId } = await ingest(harness);
      warn.mockClear();

      await harness.service.addDocument({
        userId: 'u-1',
        collectionId,
        content: 'a second document on the same index',
      });

      expect(warn).not.toHaveBeenCalled();
    });
  });

  /**
   * `bumpCollectionStats` answers `null` when the store's owner filter refuses
   * the write, which arrives here *after* the vectors are stored. Left silent it
   * is exactly the drift the bump exists to prevent: an index that has content
   * the ledger does not know about, and a document that cannot be deleted back
   * out of it.
   */
  describe('a bump the store refuses', () => {
    const refuse = (): {
      service: Service;
      collections: Map<string, KnowledgeCollection>;
      vectors: InMemoryVectorStore;
    } => {
      const collections = new Map<string, KnowledgeCollection>();
      const vectors = new InMemoryVectorStore();
      const store = makeStore(collections);
      const service = createRagService({
        config: { ...BASE_CONFIG, chunkSize: 20, chunkOverlap: 0 },
        knowledgeStore: { ...store, bumpCollectionStats: async () => null },
        vectorStore: vectors,
      });
      return { service, collections, vectors };
    };

    const seed = async (refused: ReturnType<typeof refuse>) => {
      const collection = await refused.service.createCollection({
        userId: 'u-1',
        name: 'docs',
        scope: 'private',
        chunkSize: 20,
        chunkOverlap: 0,
      });
      const added = await refused.service.addDocument({
        userId: 'u-1',
        collectionId: collection.id,
        content: 'rag alpha beta gamma delta epsilon zeta eta theta',
      });
      return { collectionId: collection.id, documentId: added.documentId };
    };

    it('warns on ingest, since the vectors land over a ledger that did not move', async () => {
      const refused = refuse();
      warn.mockClear();
      const { collectionId, documentId } = await seed(refused);

      expect(await refused.vectors.countChunks(collectionId)).toBeGreaterThan(0);
      expect(refused.collections.get(collectionId)?.chunkCount).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(`document ${documentId} in ${collectionId}`),
      );
    });

    /**
     * The log is for the operator; this is for the caller. `documentCount` is
     * ledger-only — there is no store-side document index to re-derive it from —
     * so a refused bump is the one way the collection's own count can come to
     * disagree with what the index can serve, and the caller is the only party
     * that can act on it.
     *
     * It is a flag rather than a failure because the write *did* land. Answering
     * an error would invite the retry that duplicates the content, and answering
     * plain success is what left a caller trusting a count that does not include
     * the document it just ingested.
     */
    it('reports the refused bump in the response, so the caller is not told a plain success', async () => {
      const refused = refuse();
      const collection = await refused.service.createCollection({
        userId: 'u-1',
        name: 'docs',
        chunkSize: 20,
        chunkOverlap: 0,
      });

      const added = await refused.service.addDocument({
        userId: 'u-1',
        collectionId: collection.id,
        content: 'rag alpha beta gamma delta epsilon zeta eta theta',
      });

      expect(added.ledgerStale).toBe(true);
      // `chunkCount` beside it is the store's own and stays true either way.
      expect(added.chunkCount).toBe(await refused.vectors.countChunks(collection.id));
      expect(added.chunkCount).toBeGreaterThan(0);
      // The durable count really does miss it — which is what the flag reports.
      expect(refused.collections.get(collection.id)?.documentCount).toBe(0);
    });

    it('omits the flag when the counters did move, so its absence means nothing to distrust', async () => {
      const harness = makeHarness({ chunkSize: 20, chunkOverlap: 0 });
      const collection = await harness.service.createCollection({ userId: 'u-1', name: 'docs' });

      const added = await harness.service.addDocument({
        userId: 'u-1',
        collectionId: collection.id,
        content: 'rag alpha beta gamma delta epsilon zeta eta theta',
      });

      expect(added.ledgerStale).toBeUndefined();
      expect(Object.keys(added).sort()).toEqual(['chunkCount', 'documentId']);
    });

    it('warns on delete, for the same orphaned-vector case', async () => {
      const refused = refuse();
      const { collectionId, documentId } = await seed(refused);
      warn.mockClear();

      expect(await refused.service.deleteDocument('u-1', collectionId, documentId)).toBe(true);

      expect(refused.collections.get(collectionId)?.chunkCount).toBe(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('counters did not move'));
    });
  });

  describe('minScore', () => {
    it('drops every snippet scored below the configured floor', async () => {
      const harness = makeHarness({ minScore: 0.9, hybridAlpha: 0 });
      const collectionId = await seedTwoDocuments(harness);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'unrelated vocabulary',
      });

      expect(snippets).toEqual([]);
    });

    it('keeps a snippet whose score is exactly the floor', async () => {
      const harness = makeHarness({ minScore: 1, hybridAlpha: 0 });
      const collectionId = await seedTwoDocuments(harness);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'alpha',
      });

      expect(snippets).toHaveLength(1);
      expect(snippets[0].score).toBe(1);
    });

    it('drops the same snippet once the floor sits above its score', async () => {
      const harness = makeHarness({ minScore: 1.0001, hybridAlpha: 0 });
      const collectionId = await seedTwoDocuments(harness);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'alpha',
      });

      expect(snippets).toEqual([]);
    });

    /**
     * One query, one collection, one configuration; the only difference between
     * the two runs is whether the semantic client found anything at all — and
     * what it found is an unrelated chunk. A chunk's score has to depend on its
     * own signals and the configured alpha, not on whether some *other* chunk
     * was matched semantically, or `minScore` means one thing on a query that
     * returned a hit and a different thing on the next.
     */
    it('reads the floor the same way whether or not the semantic half came back with hits', async () => {
      const rank = async (semanticHit: boolean, minScore: number) => {
        const harness = makeHarness(
          { minScore, hybridAlpha: 0.5 },
          {
            /** A hit on a chunk that is not in the collection at all: it cannot
             *  change any other chunk's evidence, only the weight applied to it. */
            search: async () =>
              semanticHit ? [chunkOf('any', 'doc-x', 0, 'unrelated prose')] : [],
          },
        );
        const collection = await harness.service.createCollection({
          userId: 'u-1',
          name: 'docs',
          scope: 'private',
        });
        await harness.vectorStore.upsertChunks(collection.id, [
          chunkOf(collection.id, 'doc-a', 0, 'alpha beta'),
          chunkOf(collection.id, 'doc-c', 0, 'alpha gamma'),
        ]);

        const snippets = await snippetsOf(harness.service, {
          userId: 'u-1',
          collectionId: collection.id,
          // Two tokens, so `doc-c` matches only half of them: kw 1 for `doc-a`,
          // 0.5 for `doc-c`.
          query: 'alpha beta',
        });
        return snippets
          .map((s) => [s.documentId, s.score, s.source] as const)
          .sort(([a], [b]) => a.localeCompare(b));
      };

      /** The two collections' own chunks, which the hit cannot justify. */
      const ownChunks = (rows: Awaited<ReturnType<typeof rank>>) =>
        rows.filter(([id]) => id !== 'doc-x');

      // With corrected semantics, a semantic hit on an unrelated chunk does not
      // scale the keyword scores of collection chunks that have no semantic signal.
      // Both runs produce the same unscaled keyword scores: 1.0 for exact match,
      // 0.5 for partial match.
      expect(ownChunks(await rank(true, 0))).toEqual([
        ['doc-a', 1, 'keyword'],
        ['doc-c', 0.5, 'keyword'],
      ]);
      expect(ownChunks(await rank(false, 0))).toEqual(ownChunks(await rank(true, 0)));
      // A floor above 1.0 drops everything; above 0.5 drops the partial match only.
      expect(await rank(true, 1.5)).toEqual([]);
      expect(await rank(false, 1.5)).toEqual([]);
      expect(ownChunks(await rank(true, 0.75))).toEqual([['doc-a', 1, 'keyword']]);
      expect(ownChunks(await rank(false, 0.75))).toEqual([['doc-a', 1, 'keyword']]);
      // At floor 0.5, both survive in both runs.
      expect(ownChunks(await rank(true, 0.5))).toEqual(ownChunks(await rank(false, 0.5)));
      expect(ownChunks(await rank(true, 0.5))).toEqual([
        ['doc-a', 1, 'keyword'],
        ['doc-c', 0.5, 'keyword'],
      ]);
    });
  });

  /**
   * What an *empty* semantic half does to the keyword half.
   *
   * `blended` used to be decided by whether a semantic client was injected rather
   * than by what the client returned, so a client that answered with nothing still
   * weighted every keyword score by `(1 - alpha)`. The factor is not small: at the
   * shipped `hybridAlpha: 0.5` it halves every score, and it scales with the
   * operator's alpha, so a query whose only evidence is keyword could lose its
   * results through the floor `minScore` filters on.
   *
   * Nothing observes this today — no shipped wiring injects a semantic client, so
   * `blended` is always false in production — which is exactly why it has to be
   * pinned here rather than discovered by the first person who wires one.
   */
  describe('a semantic client that comes back with nothing', () => {
    /**
     * Ten query tokens, one of them in `doc-0` and two in `doc-1`'s favour, so
     * `keywordScore` is 0.2 and 0.1: the marginal chunk sits exactly on the shipped
     * `minScore`, so keyword search alone returns it and a scale of anything below
     * 1 drops it. The other tokens are chosen not to be substrings of either chunk,
     * since `keywordScore` matches on `includes`.
     */
    const QUERY =
      'quarterly revenue retention activation churn discount funnel cohort lifetime margin';
    const CORPUS = ['quarterly revenue', 'quarterly'];

    const ranked = async (
      overrides: Partial<RagServiceDeps['config']>,
      semantic?: { search(collectionId: string, query: string, limit: number): Promise<VectorChunk[]> },
    ) => {
      const harness = makeHarness(overrides, semantic);
      const collection = await harness.service.createCollection({
        userId: 'u-1',
        name: 'docs',
        scope: 'private',
      });
      await harness.vectorStore.upsertChunks(
        collection.id,
        CORPUS.map((text, index) => chunkOf(collection.id, `doc-${index}`, 0, text)),
      );
      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId: collection.id,
        query: QUERY,
      });
      return snippets
        .map((s) => [s.documentId, s.score, s.source] as const)
        .sort(([a], [b]) => a.localeCompare(b));
    };

    /** The answer with no client injected: the keyword half is the whole score. */
    const keywordOnly = (minScore = RAG_DEFAULTS.minScore) =>
      ranked({ minScore, hybridAlpha: RAG_DEFAULTS.hybridAlpha });

    it('returns, at full keyword score, exactly what keyword search alone returned', async () => {
      const shipped = { minScore: RAG_DEFAULTS.minScore, hybridAlpha: RAG_DEFAULTS.hybridAlpha };

      expect(await keywordOnly()).toEqual([
        ['doc-0', 0.2, 'keyword'],
        ['doc-1', 0.1, 'keyword'],
      ]);
      expect(await ranked(shipped, { search: async () => [] })).toEqual(await keywordOnly());
    });

    it('empties the result set entirely once alpha is raised, at the same keyword evidence', async () => {
      // The scale is `(1 - alpha)`, so this is the shape of the failure: the higher
      // an operator trusts the semantic half, the more a *silent* semantic half
      // costs them, and the less their result set depends on what they can search.
      const tuned = { minScore: RAG_DEFAULTS.minScore, hybridAlpha: 0.9 };

      expect(await keywordOnly()).toHaveLength(2);
      expect(await ranked(tuned, { search: async () => [] })).toEqual(await keywordOnly());
    });

    it('leaves the keyword-only path byte-identical, since nothing above touches it', async () => {
      // No client, so the floor still cuts exactly where the keyword score says it
      // does — including on the chunk whose score is the floor itself.
      expect(await keywordOnly(0.2 as any)).toEqual([['doc-0', 0.2, 'keyword']]);
      expect(await keywordOnly(0.2001 as any)).toEqual([]);
    });

    /**
     * The per-candidate rule in one pair of assertions: the half that came back with
     * a hit is blended as it always was, and the candidate it did *not* return keeps
     * the keyword evidence it actually has rather than a share of it.
     */
    it('blends a candidate it returned and leaves a candidate it missed at its keyword score', async () => {
      const harness = makeHarness(
        { minScore: 0, hybridAlpha: RAG_DEFAULTS.hybridAlpha },
        { search: async () => [chunkOf('any', 'doc-1', 0, 'quarterly')] },
      );
      const collection = await harness.service.createCollection({
        userId: 'u-1',
        name: 'docs',
        scope: 'private',
      });
      await harness.vectorStore.upsertChunks(
        collection.id,
        CORPUS.map((text, index) => chunkOf(collection.id, `doc-${index}`, 0, text)),
      );

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId: collection.id,
        query: QUERY,
      });

      // doc-1: `alpha * 1 + (1 - alpha) * 0.1`. doc-0: semantic had nothing to say
      // about it, so its keyword score stands and is not scaled by alpha.
      expect(snippets.map((s) => [s.documentId, s.score, s.source])).toEqual([
        ['doc-1', 0.55, 'hybrid'],
        ['doc-0', 0.2, 'keyword'],
      ]);
    });
  });

  describe('topK', () => {
    const seedFiveChunks = async (harness: Harness): Promise<string> => {
      const collection = await harness.service.createCollection({
        userId: 'u-1',
        name: 'docs',
        scope: 'private',
      });
      await harness.vectorStore.upsertChunks(
        collection.id,
        [0, 1, 2, 3, 4].map((i) => chunkOf(collection.id, 'd-1', i, `rag chunk ${i}`)),
      );
      return collection.id;
    };

    it('truncates to the topK supplied on the request', async () => {
      const harness = makeHarness({ minScore: 0, topK: 6 });
      const collectionId = await seedFiveChunks(harness);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'rag',
        topK: 2,
      });

      expect(snippets).toHaveLength(2);
    });

    it('falls back to the configured topK when the request omits it', async () => {
      const harness = makeHarness({ minScore: 0, topK: 3 });
      const collectionId = await seedFiveChunks(harness);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'rag',
      });

      expect(snippets).toHaveLength(3);
    });
  });

  describe('hybridAlpha', () => {
    it('scores on the semantic half alone at hybridAlpha 1', async () => {
      const harness = makeHarness(
        { minScore: 0.5 },
        { search: async () => [chunkOf('any', 'doc-b', 0, 'gamma delta')] },
      );
      const collectionId = await seedTwoDocuments(harness);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'alpha',
        hybridAlpha: 1,
      });

      // With hybridAlpha=1, the blend is semantic-only for candidates that have semantic
      // signal, but keyword-only candidates retain their keyword score unscaled when they
      // lack semantic signal. Since doc-a has no semantic signal, it remains at kw=1.
      expect(snippets.map((s) => s.documentId).sort()).toEqual(['doc-a', 'doc-b']);
      expect(snippets.map((s) => s.score)).toEqual([1, 1]);
    });

    it('falls back to keyword ranking at hybridAlpha 1 rather than returning nothing when no semantic client is wired', async () => {
      const harness = makeHarness({ minScore: 0.5 });
      const collectionId = await seedTwoDocuments(harness);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'alpha',
        hybridAlpha: 1,
      });

      expect(snippets.map((s) => s.documentId)).toEqual(['doc-a']);
      expect(snippets[0].score).toBe(1);
      expect(snippets.map((s) => s.score)).toEqual(
        (
          await snippetsOf(harness.service, {
            userId: 'u-1',
            collectionId,
            query: 'alpha',
            hybridAlpha: 0,
          })
        ).map((s) => s.score),
      );
    });

    it('scores on the keyword half alone at hybridAlpha 0', async () => {
      const harness = makeHarness(
        { minScore: 0.5 },
        { search: async () => [chunkOf('any', 'doc-b', 0, 'gamma delta')] },
      );
      const collectionId = await seedTwoDocuments(harness);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'alpha',
        hybridAlpha: 0,
      });

      expect(snippets.map((s) => s.documentId)).toEqual(['doc-a']);
      expect(snippets[0].score).toBe(1);
    });

    it('halves each single-signal snippet at an intermediate hybridAlpha', async () => {
      const harness = makeHarness(
        { minScore: 0.4 },
        { search: async () => [chunkOf('any', 'doc-b', 0, 'gamma delta')] },
      );
      const collectionId = await seedTwoDocuments(harness);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'alpha',
        hybridAlpha: 0.5,
      });

      expect(snippets.map((s) => s.documentId).sort()).toEqual(['doc-a', 'doc-b']);
      // Per-candidate: semantic candidate (doc-b) blended as alpha*1+(1-alpha)*0 = 0.5;
      // keyword-only candidate (doc-a) has no semantic signal, so score remains kw=1 unscaled.
      expect(snippets.map((s) => s.score).sort()).toEqual([0.5, 1]);
    });

    it('clamps an out-of-range hybridAlpha instead of producing out-of-range scores', async () => {
      /** A semantic client is required here: these assertions are about the
       *  semantic half of the blend, and without one the keyword half is the
       *  whole score. */
      const harness = makeHarness(
        { minScore: 0 },
        { search: async () => [chunkOf('any', 'doc-b', 0, 'gamma delta')] },
      );
      const collectionId = await seedTwoDocuments(harness);
      const ranked = async (hybridAlpha: number): Promise<Array<[string, number]>> => {
        const snippets = await snippetsOf(harness.service, {
          userId: 'u-1',
          collectionId,
          query: 'alpha',
          hybridAlpha,
        });
        return snippets.map((s) => [s.documentId, s.score]);
      };

      const high = await ranked(5);
      const low = await ranked(-5);

      // With corrected per-candidate semantics, clamping alpha affects only blended candidates.
      // At alpha=5 (clamped to 1), doc-b (has semantic signal) blends as 1*1+0*0=1; doc-a (no semantic)
      // keeps kw=1. At alpha=-5 (clamped to 0), doc-b blends as 0*1+1*0=0; doc-a keeps kw=1.
      expect(high.map(([id, score]) => [id, score]).sort((a,b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
        ['doc-a', 1],
        ['doc-b', 1],
      ]);
      expect(low.map(([id, score]) => [id, score]).sort((a,b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
        ['doc-a', 1],
        ['doc-b', 0],
      ]);
      expect(high).toEqual(await ranked(1));
      expect(low).toEqual(await ranked(0));
      for (const [, score] of [...high, ...low]) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('source label', () => {
    it('labels a snippet reached by both halves as hybrid', async () => {
      const harness = makeHarness(
        { minScore: 0 },
        { search: async () => [chunkOf('any', 'doc-a', 0, 'alpha beta')] },
      );
      const collectionId = await seedTwoDocuments(harness);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'alpha',
      });

      const byDoc = Object.fromEntries(snippets.map((s) => [s.documentId, s]));
      expect(byDoc['doc-a'].source).toBe('hybrid');
      expect(byDoc['doc-a'].score).toBe(1);
    });

    it('labels a snippet reached only by the semantic client as semantic', async () => {
      const harness = makeHarness(
        { minScore: 0 },
        { search: async () => [chunkOf('any', 'doc-z', 0, 'nowhere in the store')] },
      );
      const collectionId = await seedTwoDocuments(harness);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'alpha',
      });

      const byDoc = Object.fromEntries(snippets.map((s) => [s.documentId, s]));
      expect(byDoc['doc-z'].source).toBe('semantic');
      expect(byDoc['doc-z'].score).toBe(0.5);
      expect(byDoc['doc-a'].source).toBe('keyword');
    });

    it('labels a snippet reached only by the vector store as keyword', async () => {
      const harness = makeHarness({ minScore: 0 });
      const collectionId = await seedTwoDocuments(harness);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'alpha',
      });

      expect(snippets).toHaveLength(2);
      const byDoc = Object.fromEntries(snippets.map((s) => [s.documentId, s]));
      expect(byDoc['doc-a'].source).toBe('keyword');
      expect(byDoc['doc-a'].score).toBe(1);
      expect(byDoc['doc-b'].source).toBe('keyword');
      expect(byDoc['doc-b'].score).toBe(0);
    });

    it('orders snippets by descending score', async () => {
      const harness = makeHarness(
        { minScore: 0 },
        { search: async () => [chunkOf('any', 'doc-a', 0, 'alpha beta')] },
      );
      const collectionId = await seedTwoDocuments(harness);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'alpha',
      });

      expect(snippets[0].documentId).toBe('doc-a');
      expect(snippets[0].score).toBeGreaterThan(snippets[1].score);
    });
  });
});

/**
 * The ingest-side embedder, and what it owes the retrieval path.
 *
 * Every test here is about the seam between the two halves: a chunk that carries
 * no vector cannot be scored semantically, and a deployment whose embedder quietly
 * returns nothing is the single worst outcome this subsystem can produce — it
 * looks wired, the write reports success, and every query comes back as though
 * the collection were empty. So each failure mode is pinned twice: the gap has to
 * be *reported* where a client can act on it, and keyword retrieval has to keep
 * working regardless.
 */
describe('rag service ingest embeddings', () => {
  const CONTENT = 'alpha beta gamma delta epsilon';

  /**
   * Two chunks, so a provider that drops or mismatches a vector has something to
   * drop or mismatch: with a single chunk, "answered with fewer vectors than
   * texts" and "answered with mixed dimensions" are both indistinguishable from a
   * correct answer.
   */
  const TWO_CHUNKS = { minScore: 0, chunkSize: 20 };

  /**
   * Nothing in this file clears the logger mocks, and the drift tests above warn on
   * their way past. These assertions are about what *this* ingest emitted, so each
   * test starts from an empty log rather than reading `calls[0]` across suites.
   */
  beforeEach(() => {
    warn.mockClear();
    error.mockClear();
  });

  /** One distinct finite 3-dimension vector per text. */
  const byLength: ChunkEmbedder = {
    embed: async (texts) => texts.map((text) => [text.length, 1, 0]),
  };

  const newCollection = async (harness: Harness, chunkSize = 128): Promise<string> => {
    const collection = await harness.service.createCollection({
      userId: 'u-1',
      name: 'handbook',
      scope: 'private',
      chunkSize,
      chunkOverlap: 0,
    });
    return collection.id;
  };

  const ingest = (harness: Harness, collectionId: string, content = CONTENT) =>
    harness.service.addDocument({ userId: 'u-1', collectionId, content, source: 'handbook.txt' });

  /**
   * Every chunk the store holds for a collection. `semanticSearch` ranks rather
   * than filters, so a high limit reads back the whole index whatever the query
   * matches — which is what a test asserting "no chunk carries a vector" needs.
   */
  const storedChunks = async (harness: Harness, collectionId: string) =>
    harness.vectorStore.semanticSearch(collectionId, 'alpha', 100);

  describe('with no embedder — the shipped state, and the default', () => {
    it('stores chunks with no embedding key at all', async () => {
      const harness = makeHarness();
      const collectionId = await newCollection(harness);

      await ingest(harness, collectionId);

      const chunks = await storedChunks(harness, collectionId);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe(CONTENT);
      // The key is *absent*, not present-and-empty: `cosineSimilarity` treats
      // `[]` and `undefined` alike, so a stored `[]` would read as a vector that
      // happened to score nothing, which is the failure this whole seam exists to
      // make visible.
      expect(chunks[0]).not.toHaveProperty('embedding');
    });

    it('reports no caveat, so its absence is not read as a failure', async () => {
      const harness = makeHarness();

      const added = await ingest(harness, await newCollection(harness));

      expect(added).toEqual({ documentId: expect.any(String), chunkCount: 1 });
    });

    it('logs nothing about embeddings, because nothing was attempted', async () => {
      const harness = makeHarness();
      await ingest(harness, await newCollection(harness));

      expect(warn).not.toHaveBeenCalled();
    });

    /**
     * The byte-identical claim, on the side a client can see. With the embedder
     * absent the whole result has to be what it was — same snippet, same score,
     * same label — because the shipped wiring supplies no embedder and this
     * method is on the write path of every document.
     */
    it('retrieves exactly what it retrieved before the embedder existed', async () => {
      const harness = makeHarness({ minScore: 0 });
      const collectionId = await newCollection(harness);
      const added = await ingest(harness, collectionId);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'alpha beta',
      });

      expect(snippets).toEqual([
        {
          collectionId,
          documentId: added.documentId,
          chunkIndex: 0,
          text: CONTENT,
          score: 1,
          source: 'keyword',
          metadata: { source: 'handbook.txt' },
        },
      ]);
    });
  });

  describe('with an embedder', () => {
    it('fills VectorChunk.embedding on every chunk it wrote', async () => {
      const harness = makeHarness({}, undefined, undefined, { embedder: byLength });
      const collectionId = await newCollection(harness);

      const added = await ingest(harness, collectionId);

      expect(added).toEqual({ documentId: expect.any(String), chunkCount: 1 });
      const [chunk] = await storedChunks(harness, collectionId);
      expect(chunk.embedding).toEqual([CONTENT.length, 1, 0]);
    });

    it('pairs each vector with its own chunk across a multi-chunk document', async () => {
      const harness = makeHarness({ chunkSize: 20 }, undefined, undefined, { embedder: byLength });
      const collectionId = await newCollection(harness, 20);

      const added = await ingest(harness, collectionId);

      expect(added.chunkCount).toBeGreaterThan(1);
      for (const chunk of await storedChunks(harness, collectionId)) {
        // The vector encodes its own text's length, so a vector attached to the
        // wrong chunk shows up as a length that does not match.
        expect(chunk.embedding?.[0]).toBe(chunk.text.length);
      }
    });

    it('reports no caveat and logs nothing when every chunk came back embedded', async () => {
      const harness = makeHarness({}, undefined, undefined, { embedder: byLength });

      const added = await ingest(harness, await newCollection(harness));

      expect(added.embedding).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    });

    it('sends the document through the configured number of texts per call', async () => {
      const embed = jest.fn(byLength.embed);
      const harness = makeHarness({ chunkSize: 20, embeddingBatchSize: 2 }, undefined, undefined, {
        embedder: { embed },
      });
      const collectionId = await newCollection(harness, 20);

      const added = await ingest(harness, collectionId);

      expect(embed).toHaveBeenCalledTimes(Math.ceil(added.chunkCount / 2));
      expect(Math.max(...embed.mock.calls.map(([texts]) => texts.length))).toBe(2);
    });

    it('falls back to the deployment default batch size when the lever is omitted', async () => {
      // A service wired before these levers existed still gets today's behaviour,
      // which is the guarantee a new config field is supposed to carry.
      const embed = jest.fn(byLength.embed);
      const harness = makeHarness({ chunkSize: 20 }, undefined, undefined, {
        embedder: { embed },
      });
      const collectionId = await newCollection(harness, 20);

      const added = await ingest(harness, collectionId);

      expect(added.chunkCount).toBeGreaterThan(1);
      expect(added.chunkCount).toBeLessThan(RAG_DEFAULTS.embeddingBatchSize);
      expect(embed).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Six ways for a wired-up provider to return nothing, each of which used to be
   * indistinguishable from "nothing matched". Every one is asserted three ways: the
   * document still lands, keyword retrieval still finds it, and the gap is named.
   *
   * `embedded` is not always 0, and the difference is the point. A provider that
   * answers with the *wrong number* of vectors has lost the pairing, so the batch
   * goes; a provider whose vectors fail per-slot validation has kept the pairing,
   * so the slots that pass are still usable and are kept. Reporting the difference
   * is what lets an operator tell "the document is unsearchable" from "half of it
   * is".
   */
  const BROKEN: Array<
    [label: string, build: () => ChunkEmbedder, degraded: EmbedDegradation, embedded: number]
  > = [
    [
      'the embedder rejects',
      () => ({ embed: () => Promise.reject(new Error('401')) }),
      'failed',
      0,
    ],
    [
      'the embedder throws synchronously',
      () => ({
        embed: () => {
          throw new Error('SDK not configured');
        },
      }),
      'failed',
      0,
    ],
    ['the embedder answers with nothing', () => ({ embed: async () => [] }), 'misaligned', 0],
    [
      'the embedder answers with fewer vectors than texts',
      () => ({ embed: async (texts: string[]) => texts.slice(0, -1).map(() => [1, 1, 0]) }),
      'misaligned',
      0,
    ],
    [
      'the embedder answers with empty vectors',
      () => ({ embed: async (texts: string[]) => texts.map(() => []) }),
      'unusable',
      0,
    ],
    [
      'the embedder answers with mixed-dimension vectors',
      () => ({
        embed: async (texts: string[]) =>
          texts.map((_text, index) => (index === 0 ? [1, 0, 0] : [1, 0])),
      }),
      'unusable',
      1,
    ],
  ];

  describe.each(BROKEN)('when %s', (_label, build, degraded, embedded) => {
    it('stores every chunk, carrying a vector on exactly the slots that earned one', async () => {
      const harness = makeHarness(TWO_CHUNKS, undefined, undefined, { embedder: build() });
      const collectionId = await newCollection(harness, TWO_CHUNKS.chunkSize);

      const added = await ingest(harness, collectionId);

      expect(added.chunkCount).toBeGreaterThan(1);
      const chunks = await storedChunks(harness, collectionId);
      expect(chunks).toHaveLength(added.chunkCount);
      // No half-written vector: a slot either carries a usable one or carries no
      // key at all, never a truncated or misaligned one.
      expect(chunks.filter((chunk) => 'embedding' in chunk)).toHaveLength(embedded);
    });

    it('still returns the document by keyword, at full keyword score', async () => {
      const harness = makeHarness(TWO_CHUNKS, undefined, undefined, { embedder: build() });
      const collectionId = await newCollection(harness, TWO_CHUNKS.chunkSize);
      const added = await ingest(harness, collectionId);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'alpha beta',
      });

      expect(snippets).toEqual(
        expect.arrayContaining([
          {
            collectionId,
            documentId: added.documentId,
            chunkIndex: expect.any(Number),
            text: expect.any(String),
            score: 1,
            source: 'keyword',
            metadata: { source: 'handbook.txt' },
          },
        ]),
      );
    });

    it('reports the gap in the response', async () => {
      const harness = makeHarness(TWO_CHUNKS, undefined, undefined, { embedder: build() });
      const collectionId = await newCollection(harness, TWO_CHUNKS.chunkSize);

      const added = await ingest(harness, collectionId);

      expect(added.embedding).toEqual({ embedded, total: added.chunkCount, degraded });
    });

    it('warns with the counts, the reason and what to do about it', async () => {
      const harness = makeHarness(TWO_CHUNKS, undefined, undefined, { embedder: build() });
      const collectionId = await newCollection(harness, TWO_CHUNKS.chunkSize);
      const added = await ingest(harness, collectionId);

      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(line).toContain(collectionId);
      expect(line).toContain(`${embedded} embedding(s)`);
      expect(line).toContain(degraded);
      expect(line).toContain('retrievable by keyword');
      // `total` has to agree with the ledger, or the report is its own inconsistency.
      expect(line).toContain(String(added.chunkCount));
    });
  });

  describe('when the embedder never answers', () => {
    const neverAnswers: ChunkEmbedder = { embed: () => new Promise<number[][]>(() => {}) };
    /** Short enough to keep the suite quick, and short enough to prove the bound is honoured. */
    const bounded = { minScore: 0, embeddingTimeoutMs: 10 };

    it('does not hold the write open, and the document still lands', async () => {
      const harness = makeHarness(bounded, undefined, undefined, { embedder: neverAnswers });
      const collectionId = await newCollection(harness);

      const added = await ingest(harness, collectionId);

      expect(added).toEqual({
        documentId: expect.any(String),
        chunkCount: 1,
        embedding: { embedded: 0, total: 1, degraded: 'timed-out' },
      });
      expect(await harness.vectorStore.countChunks(collectionId)).toBe(1);
    });

    it('still returns the document by keyword, at full keyword score', async () => {
      const harness = makeHarness(bounded, undefined, undefined, { embedder: neverAnswers });
      const collectionId = await newCollection(harness);
      const added = await ingest(harness, collectionId);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'alpha beta',
      });

      expect(snippets.map((s) => [s.documentId, s.score, s.source])).toEqual([
        [added.documentId, 1, 'keyword'],
      ]);
    });

    it('names the lever that bounds it in the log line', async () => {
      const harness = makeHarness(bounded, undefined, undefined, { embedder: neverAnswers });
      await ingest(harness, await newCollection(harness));

      expect(String(warn.mock.calls[0][0])).toContain('embeddingTimeoutMs');
    });
  });

  /**
   * Both seams live — the only configuration in which the semantic half of
   * `retrieve` can do anything, because it scores candidates against vectors only
   * the embedder can have written. The client below is the real
   * `createSemanticSearchService`, over the same injected index the service reads.
   */
  describe('with the embedder and a semantic client both live', () => {
    /** The real semantic service, over the index this harness's service will read. */
    const semanticOver = (
      vectorStore: InMemoryVectorStore,
      embedder: ChunkEmbedder,
      semanticMinScore: number,
    ) => {
      const client = createSemanticSearchService({
        config: { candidateK: 32, topK: 6, minScore: semanticMinScore },
        vectorStore,
        embeddings: {
          dimension: 3,
          embed: async (text: string) => (await embedder.embed([text]))[0],
        },
      });
      return { search: client.search };
    };

    /**
     * A query no chunk contains, so `kw` is 0 for every candidate and only the
     * semantic half can put anything over the floor. Keyword-only retrieval answers
     * `[]` on this exact corpus, which is asserted first — so the hits below can
     * only have come from the vectors ingest wrote.
     */
    const semanticHarness = (minScore: number, embedder = byLength) => {
      const vectorStore = new InMemoryVectorStore();
      const semantic = semanticOver(vectorStore, embedder, 0.1);
      return makeHarness({ minScore, chunkSize: 20 }, semantic, undefined, {
        embedder,
        vectorStore,
      });
    };

    it('returns nothing on a query no chunk matches when only the embedder is wired', async () => {
      const harness = makeHarness({ minScore: 0.4, chunkSize: 20 }, undefined, undefined, {
        embedder: byLength,
      });
      const collectionId = await newCollection(harness, 20);
      await ingest(harness, collectionId);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'zzz',
      });

      // The asymmetry that hid this gap for so long: an embedder with no semantic
      // client writes vectors nobody reads, and retrieval must not start reporting
      // semantic sources on its own.
      expect(snippets).toEqual([]);
    });

    it('joins the semantic half, so the same query now returns the document', async () => {
      const keywordOnly = makeHarness({ minScore: 0.4, chunkSize: 20 });
      const keywordOnlyId = await newCollection(keywordOnly, 20);
      await ingest(keywordOnly, keywordOnlyId);
      expect(
        await snippetsOf(keywordOnly.service, {
          userId: 'u-1',
          collectionId: keywordOnlyId,
          query: 'zzz',
        }),
      ).toEqual([]);

      const harness = semanticHarness(0.4);
      const collectionId = await newCollection(harness, 20);
      const added = await ingest(harness, collectionId);

      const snippets = await snippetsOf(harness.service, {
        userId: 'u-1',
        collectionId,
        query: 'zzz',
      });

      expect(snippets.length).toBeGreaterThan(0);
      expect(new Set(snippets.map((s) => s.documentId))).toEqual(new Set([added.documentId]));
      expect(snippets.every((s) => s.source === 'semantic')).toBe(true);
    });

    /**
     * The claim that was false while the seam was unfed, pinned where it can now be
     * true. `kw` is 0 for this query, so every score is `alpha * sem` and the
     * ranking follows the alpha directly — twice, on the same corpus and the same
     * index, with only the request's `hybridAlpha` differing.
     */
    it('lets hybridAlpha change the result while the semantic half is live', async () => {
      const harness = semanticHarness(0);
      const collectionId = await newCollection(harness, 20);
      await ingest(harness, collectionId);

      const rankedAt = async (hybridAlpha: number) =>
        (
          await snippetsOf(harness.service, {
            userId: 'u-1',
            collectionId,
            query: 'zzz',
            hybridAlpha,
          })
        ).map((s) => [s.score, s.source]);

      // 1 at alpha 1, 0.25 at alpha 0.25, and the ordering follows the semantic
      // half rather than being pinned at the keyword value.
      expect(await rankedAt(1)).toEqual(expect.arrayContaining([[1, 'semantic']]));
      expect(await rankedAt(0.25)).toEqual(expect.arrayContaining([[0.25, 'semantic']]));
    });

    it('reverts to pure keyword ranking when the semantic client is absent', async () => {
      // The other half of the same guarantee: the embedder alone must not change
      // a score, or a deployment would see its ranking shift because a write-path
      // dependency was switched on.
      const vectorStore = new InMemoryVectorStore();
      const withEmbedder = makeHarness({ minScore: 0, chunkSize: 20 }, undefined, undefined, {
        embedder: byLength,
        vectorStore,
      });
      const collectionId = await newCollection(withEmbedder, 20);
      await ingest(withEmbedder, collectionId);

      const snippets = await snippetsOf(withEmbedder.service, {
        userId: 'u-1',
        collectionId,
        query: 'alpha beta gamma',
        hybridAlpha: 1,
      });

      expect(snippets.map((s) => [s.score, s.source])).toEqual(
        expect.arrayContaining([[1, 'keyword']]),
      );
    });
  });

  describe('the post-merge reranker', () => {
    it('reaches the service through the same injection as the embedder', async () => {
      // P1-13: `retrieve` has consumed `deps.reranker` all along, and the runtime
      // had no way to supply it. One assertion that the seam is now reachable.
      const rerank = jest.fn(async (_query: string, snippets: RetrievedSnippet[]) => snippets);
      const harness = makeHarness({ minScore: 0 }, undefined, undefined, {
        reranker: { rerank } satisfies SnippetReranker,
      });
      const collectionId = await newCollection(harness);
      await ingest(harness, collectionId);

      await snippetsOf(harness.service, { userId: 'u-1', collectionId, query: 'alpha' });

      expect(rerank).toHaveBeenCalledTimes(1);
    });
  });
});
