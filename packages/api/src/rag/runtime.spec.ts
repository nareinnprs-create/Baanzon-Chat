import type { KnowledgeCollection, RetrievedSnippet, VectorChunk } from './types';
import type { RagRuntimeConfig, RagRuntimeDeps } from './runtime';
import type { MongoKnowledgeStoreDeps } from './knowledgeStore';
import type { ChunkEmbedder } from './embeddings';
import type { SnippetReranker } from './service';
import { createRagRuntime, resolveRagConfig, createRagRuntimeResolver } from './runtime';
import { InMemoryVectorStore } from './vectorStores';
import { RAG_DEFAULTS, RAG_API_URL } from './config';

interface StoreDeps {
  knowledgeMethods: MongoKnowledgeStoreDeps;
  vectorStore: InMemoryVectorStore;
}

/**
 * `pageSize` and `count` are the two halves of the capped page, and they are
 * knobs here so the wiring can be tested against a store that both caps and
 * counts, a store that caps without counting, and one that counts without
 * capping. The default is the deployed shape: full `~/models` methods, uncapped
 * double.
 */
function makeDeps({
  count = true,
  pageSize,
}: { count?: boolean; pageSize?: number } = {}): StoreDeps {
  const rows = new Map<string, KnowledgeCollection>();
  const visible = (userId: string) =>
    [...rows.values()].filter((r) => r.userId === userId || r.scope === 'global');
  return {
    vectorStore: new InMemoryVectorStore(),
    knowledgeMethods: {
      createKnowledgeCollection: jest.fn(async (input: { id: string }) => {
        const row = {
          ...(input as unknown as KnowledgeCollection),
          documentCount: 0,
          chunkCount: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        };
        rows.set(row.id, row);
        return row;
      }),
      getKnowledgeCollection: jest.fn(async (userId: string, id: string) => {
        const row = rows.get(id);
        return row != null && (row.userId === userId || row.scope === 'global') ? row : null;
      }),
      listKnowledgeCollections: jest.fn(async (userId: string) =>
        pageSize == null ? visible(userId) : visible(userId).slice(0, pageSize),
      ),
      ...(count
        ? { countKnowledgeCollections: jest.fn(async (userId: string) => visible(userId).length) }
        : {}),
      updateKnowledgeCollection: jest.fn(
        async (userId: string, id: string, patch: Partial<KnowledgeCollection>) => {
          const row = rows.get(id);
          if (row == null || row.userId !== userId) {
            return null;
          }
          const next = { ...row, ...patch };
          rows.set(id, next);
          return next;
        },
      ),
      bumpKnowledgeCollectionStats: jest.fn(
        async (
          userId: string,
          id: string,
          delta: { documentDelta: number; chunkDelta: number },
        ) => {
          const row = rows.get(id);
          // Owner-only, like `updateKnowledgeCollection`'s `{ id, userId }` filter.
          if (row == null || row.userId !== userId) {
            return null;
          }
          // Read the counts and add the delta in the same synchronous step, with
          // no await in between — that is what the store's single `$inc` buys. Do
          // not "simplify" this into a read followed by an awaited write: that is
          // the read-modify-write race the delta exists to remove.
          const next = {
            ...row,
            documentCount: row.documentCount + delta.documentDelta,
            chunkCount: row.chunkCount + delta.chunkDelta,
          };
          rows.set(id, next);
          return next;
        },
      ),
      deleteKnowledgeCollection: jest.fn(async (userId: string, id: string) => {
        const row = rows.get(id);
        if (row == null || row.userId !== userId) {
          return false;
        }
        rows.delete(id);
        return true;
      }),
    } as unknown as MongoKnowledgeStoreDeps,
  };
}

function depsOf(
  overrides: Partial<RagRuntimeDeps> = {},
  store: { count?: boolean; pageSize?: number } = {},
): RagRuntimeDeps {
  const { knowledgeMethods, vectorStore } = makeDeps(store);
  return { knowledgeMethods, vectorStore, ...overrides };
}

/**
 * `countKnowledgeCollections` is not on the `MongoKnowledgeStoreDeps` port: that
 * interface is the domain's view of the store and the count is additive, so the
 * runtime reads the method off the methods object through a narrow type and
 * treats its absence as a normal case. Reached the same way here, so these
 * assertions are about the call the runtime actually makes.
 */
function countMockOf(
  methods: MongoKnowledgeStoreDeps,
): ((userId: string) => Promise<number>) | undefined {
  return (methods as { countKnowledgeCollections?: (userId: string) => Promise<number> })
    .countKnowledgeCollections;
}

describe('resolveRagConfig', () => {
  const originalApiUrl = process.env[RAG_API_URL];

  beforeEach(() => {
    delete process.env[RAG_API_URL];
  });

  afterAll(() => {
    if (originalApiUrl === undefined) {
      delete process.env[RAG_API_URL];
    } else {
      process.env[RAG_API_URL] = originalApiUrl;
    }
  });

  it('prefers the config value over the RAG_API_URL env var', () => {
    process.env[RAG_API_URL] = 'https://env.example.com';

    const config = resolveRagConfig({ apiUrl: 'https://config.example.com' });

    expect(config.apiUrl).toBe('https://config.example.com');
  });

  it('uses RAG_API_URL from the environment when the config omits apiUrl', () => {
    process.env[RAG_API_URL] = 'https://env.example.com';

    const config = resolveRagConfig({ topK: 3 });

    expect(config.apiUrl).toBe('https://env.example.com');
  });

  it('uses RAG_API_URL from the environment when there is no config at all', () => {
    process.env[RAG_API_URL] = 'https://env.example.com';

    expect(resolveRagConfig().apiUrl).toBe('https://env.example.com');
  });

  it('falls back to RAG_DEFAULTS for every field the config and the env omit', () => {
    const config = resolveRagConfig();

    expect(config).toEqual({
      disabled: RAG_DEFAULTS.disabled,
      apiUrl: '',
      chunkSize: RAG_DEFAULTS.chunkSize,
      chunkOverlap: RAG_DEFAULTS.chunkOverlap,
      hybridAlpha: RAG_DEFAULTS.hybridAlpha,
      candidateK: RAG_DEFAULTS.candidateK,
      topK: RAG_DEFAULTS.topK,
      minScore: RAG_DEFAULTS.minScore,
      inMemoryMaxCollections: RAG_DEFAULTS.inMemoryMaxCollections,
      inMemoryMaxChunks: RAG_DEFAULTS.inMemoryMaxChunks,
      embeddingTimeoutMs: RAG_DEFAULTS.embeddingTimeoutMs,
      embeddingBatchSize: RAG_DEFAULTS.embeddingBatchSize,
      embeddingConcurrency: RAG_DEFAULTS.embeddingConcurrency,
    });
  });

  it('lets the config override each individual default', () => {
    const config = resolveRagConfig({
      disabled: true,
      chunkSize: 111,
      chunkOverlap: 22,
      hybridAlpha: 0.75,
      candidateK: 8,
      topK: 4,
      minScore: 0.5,
      inMemoryMaxCollections: 5,
      inMemoryMaxChunks: 50,
      embeddingTimeoutMs: 1000,
      embeddingBatchSize: 8,
      embeddingConcurrency: 3,
    });

    expect(config).toEqual({
      disabled: true,
      apiUrl: '',
      chunkSize: 111,
      chunkOverlap: 22,
      hybridAlpha: 0.75,
      candidateK: 8,
      topK: 4,
      minScore: 0.5,
      inMemoryMaxCollections: 5,
      inMemoryMaxChunks: 50,
      embeddingTimeoutMs: 1000,
      embeddingBatchSize: 8,
      embeddingConcurrency: 3,
    });
  });

  it('leaves apiUrl empty when neither the config nor the env supplies one', () => {
    expect(resolveRagConfig({ topK: 1 }).apiUrl).toBe('');
  });
});

describe('createRagRuntime', () => {
  const originalApiUrl = process.env[RAG_API_URL];

  beforeEach(() => {
    delete process.env[RAG_API_URL];
  });

  afterAll(() => {
    if (originalApiUrl === undefined) {
      delete process.env[RAG_API_URL];
    } else {
      process.env[RAG_API_URL] = originalApiUrl;
    }
  });

  it('exposes only the domain handlers and the disabled flag', () => {
    const runtime = createRagRuntime(depsOf());

    expect(Object.keys(runtime).sort()).toEqual(['disabled', 'domainHandlers']);
  });

  it('pushes the resolved limits onto the injected store via applyLimits', () => {
    const deps = depsOf();
    const applyLimits = jest.spyOn(deps.vectorStore, 'applyLimits');

    createRagRuntime(deps, { inMemoryMaxCollections: 7, inMemoryMaxChunks: 11 });

    expect(applyLimits).toHaveBeenCalledTimes(1);
    expect(applyLimits).toHaveBeenCalledWith({ maxCollections: 7, maxChunks: 11 });
  });

  it('applies the default limits when the config omits them', () => {
    const deps = depsOf();
    const applyLimits = jest.spyOn(deps.vectorStore, 'applyLimits');

    createRagRuntime(deps, { topK: 2 });

    expect(applyLimits).toHaveBeenCalledWith({
      maxCollections: RAG_DEFAULTS.inMemoryMaxCollections,
      maxChunks: RAG_DEFAULTS.inMemoryMaxChunks,
    });
  });

  it('enforces the applied chunk limit on the shared store', async () => {
    const deps = depsOf();

    createRagRuntime(deps, { inMemoryMaxChunks: 2 });
    const chunk: VectorChunk = {
      collectionId: 'c-1',
      documentId: 'd-1',
      chunkIndex: 0,
      text: 'alpha',
    };
    await deps.vectorStore.upsertChunk('c-1', chunk);
    await expect(
      deps.vectorStore.upsertChunk('c-1', { ...chunk, chunkIndex: 1 }),
    ).resolves.toBeUndefined();
    await expect(deps.vectorStore.upsertChunk('c-1', { ...chunk, chunkIndex: 2 })).rejects.toThrow(
      /full \(2 chunks\)/,
    );
  });

  it('defaults the kill switch to RAG_DEFAULTS.disabled', () => {
    // The one source of truth, not a literal. This used to read `?? false`
    // here while `resolveRagConfig` defaulted the same field to
    // `RAG_DEFAULTS.disabled`, so a config that omitted it resolved enabled on
    // one path and disabled on the other. Knowledge retrieval is opt-in, so the
    // default is `true`; the assertion is against the constant so the two stay
    // in step if it ever moves.
    expect(createRagRuntime(depsOf()).disabled).toBe(RAG_DEFAULTS.disabled);
  });

  it('reports disabled: false when the config turns the kill switch off', () => {
    // The other direction, and the one that matters for the deployed wiring:
    // enabling RAG is an explicit choice in `baanzon.yaml`, never a side effect
    // of leaving the field out.
    expect(createRagRuntime(depsOf(), { disabled: false }).disabled).toBe(false);
  });

  it('reports disabled: true when the config turns the kill switch on', () => {
    expect(createRagRuntime(depsOf(), { disabled: true }).disabled).toBe(true);
  });

  /**
   * The `usesSemantic` flag these replace described a capability that no
   * consumer read — the Express wiring never inspected the runtime — and was
   * permanently `false` in the shipped wiring, because no semantic client is
   * supplied. Rather than re-pinning a dead boolean, these pin the behaviour it
   * was standing in for: whether a semantic client was injected decides
   * whether the semantic half of the blend runs, and `apiUrl` on its own
   * decides nothing at all.
   */
  describe('the injected semantic client reaches the domain', () => {
    const CONTENT = 'rag service chunks text into pieces';
    /** Returns a chunk no query token matches, so only the semantic half can surface it. */
    const semanticEcho = {
      search: async (collectionId: string): Promise<VectorChunk[]> => [
        { collectionId, documentId: 'sem-1', chunkIndex: 0, text: CONTENT },
      ],
    };

    /** Retrieve with a query matching nothing in the stored text, on purpose. */
    const topHit = async (deps: RagRuntimeDeps) => {
      const runtime = createRagRuntime(deps);
      const created = await runtime.domainHandlers.createCollection({
        userId: 'u-1',
        name: 'handbook',
      });
      if (!created.ok) {
        throw new Error('createCollection failed');
      }
      const added = await runtime.domainHandlers.addDocument({
        userId: 'u-1',
        collectionId: created.data.id,
        content: CONTENT,
      });
      if (!added.ok) {
        throw new Error('addDocument failed');
      }
      const found = await runtime.domainHandlers.retrieve({
        userId: 'u-1',
        collectionId: created.data.id,
        query: 'zzz',
      });
      if (!found.ok) {
        throw new Error('retrieve failed');
      }
      return found.data;
    };

    it('blends the semantic half in when a client is supplied', async () => {
      const snippets = await topHit(depsOf({ semantic: semanticEcho }));

      // kw is 0 for this query, so only `0.5 * sem` puts it over the 0.1 floor.
      expect(snippets.map((s) => [s.source, s.score])).toEqual([['semantic', 0.5]]);
    });

    it('leaves retrieval keyword-only when no client is supplied', async () => {
      expect(await topHit(depsOf())).toEqual([]);
    });

    it('ignores a configured apiUrl, which changed nothing but the removed flag', async () => {
      process.env[RAG_API_URL] = 'https://env.example.com';

      expect(await topHit(depsOf())).toEqual([]);
    });
  });

  /**
   * The two write-side and post-merge seams the Express wiring supplies through
   * this runtime. Both are constructor arguments rather than module imports, so
   * the wiring line is the whole integration — which means these assertions are
   * the only thing standing between "the seam exists" and "the seam is reachable".
   */
  describe('the injected embedder reaches the domain, and its report reaches the response', () => {
    const CONTENT = 'rag service chunks text into pieces';

    const byLength: ChunkEmbedder = {
      embed: async (texts) => texts.map((text) => [text.length, 1]),
    };
    const refused: ChunkEmbedder = { embed: () => Promise.reject(new Error('no credentials')) };

    /** Adds `content` through the handler layer and returns the service's result. */
    async function ingest(deps: RagRuntimeDeps, content = CONTENT) {
      const runtime = createRagRuntime(deps);
      const created = await runtime.domainHandlers.createCollection({
        userId: 'u-1',
        name: 'handbook',
      });
      if (!created.ok) {
        throw new Error('createCollection failed');
      }
      const added = await runtime.domainHandlers.addDocument({
        userId: 'u-1',
        collectionId: created.data.id,
        content,
      });
      if (!added.ok) {
        throw new Error('addDocument failed');
      }
      return { collectionId: created.data.id, added: added.data };
    }

    it('embeds the chunks it writes, so the index carries vectors', async () => {
      const deps = depsOf({ embedder: byLength });

      const { collectionId } = await ingest(deps);

      const stored = await deps.vectorStore.semanticSearch(collectionId, 'rag', 10);
      expect(stored).toHaveLength(1);
      expect(stored[0].embedding).toEqual([CONTENT.length, 1]);
    });

    it('sends the chunks themselves, so the caller sees what was embedded', async () => {
      const embed = jest.fn(byLength.embed);

      await ingest(depsOf({ embedder: { embed } }));

      expect(embed).toHaveBeenCalledWith([CONTENT]);
    });

    it('reports nothing when every chunk was embedded, and no caveat reaches the response', async () => {
      const { added } = await ingest(depsOf({ embedder: byLength }));

      expect(added.embedding).toBeUndefined();
    });

    /**
     * The degradation contract as a client sees it. The document is stored and the
     * handler still succeeds, because a write-path dependency failing is not a
     * reason to lose the write — but the response says so in a field a client can
     * branch on, rather than leaving a silently unsearchable document.
     */
    it('reports the gap in the handler response when the embedder fails', async () => {
      const { added } = await ingest(depsOf({ embedder: refused }));

      expect(added).toEqual({
        documentId: expect.any(String),
        chunkCount: 1,
        embedding: { embedded: 0, total: 1, degraded: 'failed' },
      });
    });

    it('keeps the failed document retrievable by keyword', async () => {
      const deps = depsOf({ embedder: refused });
      const { collectionId, added } = await ingest(deps);

      const found = await createRagRuntime(deps).domainHandlers.retrieve({
        userId: 'u-1',
        collectionId,
        query: 'rag service chunks',
      });

      expect(found.ok).toBe(true);
      if (found.ok) {
        expect(found.data.map((s) => [s.documentId, s.score, s.source])).toEqual([
          [added.documentId, 1, 'keyword'],
        ]);
      }
    });

    it('writes no embedding at all when no embedder is supplied, as in the shipped wiring', async () => {
      const deps = depsOf();

      const { collectionId, added } = await ingest(deps);

      const stored = await deps.vectorStore.semanticSearch(collectionId, 'rag', 10);
      expect(stored).toHaveLength(1);
      expect(stored[0]).not.toHaveProperty('embedding');
      expect(added.embedding).toBeUndefined();
    });

    it('reaches the service through the same injection as the embedder', async () => {
      // P1-13, closed: `retrieve` has consumed `deps.reranker` all along and the
      // runtime offered no way to supply it. It is now one argument, and this is
      // the assertion that the argument is not dropped between the two.
      const rerank = jest.fn(async (_query: string, snippets: RetrievedSnippet[]) => snippets);
      const deps = depsOf({ reranker: { rerank } satisfies SnippetReranker });
      const { collectionId } = await ingest(deps);

      await createRagRuntime(deps).domainHandlers.retrieve({
        userId: 'u-1',
        collectionId,
        query: 'rag service chunks',
      });

      expect(rerank).toHaveBeenCalledTimes(1);
      expect(rerank.mock.calls[0][0]).toBe('rag service chunks');
    });
  });

  /**
   * The count the list reports is not a number the service can invent: it is a
   * separate store method, and the runtime is the only place that knows whether
   * the methods object it was handed has one. Both outcomes are pinned because
   * the failure is silent in both directions — a `total` that quietly reported
   * the page length again, and a listing that broke for anyone whose methods
   * object lacks the method.
   */
  describe('the listing count comes off the methods object', () => {
    /** Creates `count` collections and returns the listing the handler hands back. */
    async function listed(deps: RagRuntimeDeps, count: number) {
      const { domainHandlers } = createRagRuntime(deps);
      for (let index = 0; index < count; index += 1) {
        await domainHandlers.createCollection({ userId: 'u-1', name: `collection ${index}` });
      }
      const listing = await domainHandlers.listCollections('u-1');
      if (!listing.ok) {
        throw new Error('listCollections failed');
      }
      return listing.data;
    }

    it('reports the uncapped total beside a capped page', async () => {
      const deps = depsOf({}, { pageSize: 1 });

      const listing = await listed(deps, 3);

      // 1 of 3: the page is one row because the store said one, and `total` is 3
      // because a different method was asked. If the runtime had failed to wire
      // the count in, this would be 1 and read as "you have one collection".
      expect(listing.collections).toHaveLength(1);
      expect(listing.total).toBe(3);
      expect(listing.hasMore).toBe(true);
    });

    it('calls the count method with the caller, not with the collection page', async () => {
      const deps = depsOf({}, { pageSize: 1 });
      await listed(deps, 3);

      expect(countMockOf(deps.knowledgeMethods)).toHaveBeenCalledWith('u-1');
    });

    it('falls back to the page length when the methods object cannot count', async () => {
      const deps = depsOf({}, { count: false, pageSize: 2 });

      const listing = await listed(deps, 3);

      // Not an error and not a wrong number: without a count method the page is
      // reported as the whole list, which is what the response meant before
      // `total` existed. A deployment on an older methods object keeps working.
      expect(countMockOf(deps.knowledgeMethods)).toBeUndefined();
      expect(listing.collections).toHaveLength(2);
      expect(listing.total).toBe(2);
      expect(listing.hasMore).toBe(false);
    });
  });
});

describe('createRagRuntimeResolver', () => {
  /**
   * A fully populated config, so the field-by-field table below can vary exactly
   * one field at a time. Every field is set: a variant that omits one would be
   * comparing the defaults rather than the field it names.
   */
  const BASE: Required<RagRuntimeConfig> = {
    disabled: false,
    apiUrl: 'https://rag.example.com',
    chunkSize: 800,
    chunkOverlap: 80,
    hybridAlpha: 0.5,
    candidateK: 32,
    topK: 6,
    minScore: 0.1,
    inMemoryMaxCollections: 200,
    inMemoryMaxChunks: 20_000,
    embeddingTimeoutMs: 15_000,
    embeddingBatchSize: 64,
    embeddingConcurrency: 2,
  };

  it('returns the identical runtime for two configs that are equal by value', () => {
    // The property the cache is for, and the one it did not have: `req.config` is
    // rebuilt per request, so two requests carrying the same `rag:` block arrive
    // with two *different objects* describing the same configuration. Keyed on
    // identity, neither could ever hit.
    const resolve = createRagRuntimeResolver(depsOf());

    const first = resolve({ ...BASE });
    const second = resolve({ ...BASE });

    expect(second).toBe(first);
    expect(second.domainHandlers).toBe(first.domainHandlers);
  });

  it('returns a different runtime for a config that differs', () => {
    const resolve = createRagRuntimeResolver(depsOf());

    const first = resolve({ ...BASE, topK: 3 });
    const second = resolve({ ...BASE, topK: 4 });

    expect(second).not.toBe(first);
    expect(second.domainHandlers).not.toBe(first.domainHandlers);
  });

  it('shares a runtime between an absent config and an empty one, since they resolve alike', () => {
    // Not a special case in the cache: both resolve to the deployment defaults,
    // so both produce the same key. Pinning it because "no config" and "a config
    // that says nothing" are the two shapes the first request and every later
    // one can take.
    const resolve = createRagRuntimeResolver(depsOf());

    expect(resolve({})).toBe(resolve(undefined));
    expect(resolve()).toBe(resolve({}));
  });

  it('reuses a runtime after a detour through another config, rather than rebuilding it', () => {
    // A `Map` keyed by value is a cache and not a one-shot memo: the entry has to
    // survive the intervening build, which is what makes a config reload cheap
    // in both directions.
    const resolve = createRagRuntimeResolver(depsOf());

    const first = resolve({ ...BASE, topK: 3 });
    resolve({ ...BASE, topK: 4 });

    expect(resolve({ ...BASE, topK: 3 })).toBe(first);
  });

  /**
   * The collision case, field by field. A key that ignored a field — or read one
   * the runtime is actually built from — would serve a runtime built with one
   * chunk size to a request carrying another, and the failure would be silent:
   * a collection created under the wrong geometry, chunks cut at the wrong width.
   * So every field of the resolved config is varied on its own and all thirteen
   * results have to be distinct runtimes.
   */
  it('gives every field of the resolved config its own key', () => {
    const resolve = createRagRuntimeResolver(depsOf());

    const variants: Array<[field: string, config: Required<RagRuntimeConfig>]> = [
      ['disabled', { ...BASE, disabled: true }],
      ['apiUrl', { ...BASE, apiUrl: 'https://other.example.com' }],
      ['chunkSize', { ...BASE, chunkSize: 801 }],
      ['chunkOverlap', { ...BASE, chunkOverlap: 81 }],
      ['hybridAlpha', { ...BASE, hybridAlpha: 0.7 }],
      ['candidateK', { ...BASE, candidateK: 33 }],
      ['topK', { ...BASE, topK: 7 }],
      ['minScore', { ...BASE, minScore: 0.2 }],
      ['inMemoryMaxCollections', { ...BASE, inMemoryMaxCollections: 201 }],
      ['inMemoryMaxChunks', { ...BASE, inMemoryMaxChunks: 20_001 }],
      ['embeddingTimeoutMs', { ...BASE, embeddingTimeoutMs: 15_001 }],
      ['embeddingBatchSize', { ...BASE, embeddingBatchSize: 65 }],
      ['embeddingConcurrency', { ...BASE, embeddingConcurrency: 3 }],
    ];

    const runtimes = variants.map(([field, config]) => {
      const runtime = resolve(config);
      // Each variant really is distinct by value, so a shared runtime here can
      // only be a key collision rather than a duplicated test case.
      expect(resolve({ ...config })).toBe(runtime);
      return [field, runtime] as const;
    });

    expect(new Set(runtimes.map(([, runtime]) => runtime)).size).toBe(variants.length);
    expect(resolve({ ...BASE })).not.toBe(runtimes[0][1]);
  });

  /**
   * The store is process-scoped, so its limits are the one piece of shared
   * mutable state this cache touches — and re-applying them per request is what
   * let a request re-limit the store another request was mid-write against.
   * Once per distinct configuration is the whole claim, so both halves are
   * pinned: the repeat is a no-op, and a genuine change still lands.
   */
  it('applies the shared store limits once per distinct config rather than once per request', async () => {
    const deps = depsOf();
    const applyLimits = jest.spyOn(deps.vectorStore, 'applyLimits');
    const resolve = createRagRuntimeResolver(deps);

    for (let request = 0; request < 5; request += 1) {
      resolve({ ...BASE, inMemoryMaxChunks: 500 });
    }
    expect(applyLimits).toHaveBeenCalledTimes(1);
    expect(applyLimits).toHaveBeenCalledWith({ maxCollections: 200, maxChunks: 500 });

    // A config that really differs is still applied, and is the one in force
    // afterwards — read back through the store itself rather than the mock.
    resolve({ ...BASE, inMemoryMaxChunks: 1 });
    expect(applyLimits).toHaveBeenCalledTimes(2);
    expect(applyLimits).toHaveBeenNthCalledWith(2, { maxCollections: 200, maxChunks: 1 });
    const chunk = (chunkIndex: number): VectorChunk => ({
      collectionId: 'c-limits',
      documentId: 'd-1',
      chunkIndex,
      text: 'alpha',
    });
    await deps.vectorStore.upsertChunk('c-limits', chunk(0));
    // The 900-chunk build would have held these without complaint; the 1-chunk
    // one refuses the second, which is how the live limit is read back.
    await expect(deps.vectorStore.upsertChunk('c-limits', chunk(1))).rejects.toThrow(
      /full \(1 chunks\)/,
    );
  });

  it('reuses the no-config runtime across calls', () => {
    const resolve = createRagRuntimeResolver(depsOf());

    expect(resolve(undefined)).toBe(resolve(undefined));
    expect(resolve()).toBe(resolve(undefined));
  });

  it('keeps a config-scoped runtime apart from the no-config runtime', () => {
    const resolve = createRagRuntimeResolver(depsOf());

    expect(resolve({ topK: 3 })).not.toBe(resolve(undefined));
  });

  it('builds the runtime from the config it was handed', () => {
    const resolve = createRagRuntimeResolver(depsOf());
    const small = resolve({ inMemoryMaxChunks: 1 });
    const large = resolve({ inMemoryMaxChunks: 2 });

    expect(small).not.toBe(large);
  });

  describe('the vector store is process-scoped, not per-config', () => {
    it('never exposes a store on the runtime', () => {
      const resolve = createRagRuntimeResolver(depsOf());

      expect(resolve({ topK: 3 })).not.toHaveProperty('vectorStore');
    });

    it('reuses the one injected store across different config objects', async () => {
      const deps = depsOf();
      const resolve = createRagRuntimeResolver(deps);
      const applyLimits = jest.spyOn(deps.vectorStore, 'applyLimits');
      const upsertChunks = jest.spyOn(deps.vectorStore, 'upsertChunks');

      const first = resolve({ topK: 3, inMemoryMaxChunks: 50 });
      const second = resolve({ topK: 9, inMemoryMaxChunks: 60 });

      expect(first).not.toBe(second);
      // One store instance, re-limited once per config rather than rebuilt.
      expect(applyLimits).toHaveBeenCalledTimes(2);
      expect(applyLimits).toHaveBeenNthCalledWith(1, { maxCollections: 200, maxChunks: 50 });
      expect(applyLimits).toHaveBeenNthCalledWith(2, { maxCollections: 200, maxChunks: 60 });

      const firstCollection = await first.domainHandlers.createCollection({
        userId: 'u-1',
        name: 'from-first',
      });
      if (!firstCollection.ok) {
        throw new Error('createCollection failed');
      }
      await first.domainHandlers.addDocument({
        userId: 'u-1',
        collectionId: firstCollection.data.id,
        content: 'rag service chunks text into pieces',
      });
      await second.domainHandlers.addDocument({
        userId: 'u-1',
        collectionId: firstCollection.data.id,
        content: 'a second document written through the other config',
      });

      expect(upsertChunks).toHaveBeenCalledTimes(2);
      // Every write from both runtimes landed on the single injected instance.
      expect(upsertChunks.mock.instances).toEqual([deps.vectorStore, deps.vectorStore]);
    });

    it('makes a document ingested under one config readable under another', async () => {
      const deps = depsOf();
      const resolve = createRagRuntimeResolver(deps);

      const writer = resolve({ topK: 3, minScore: 0 });
      const created = await writer.domainHandlers.createCollection({
        userId: 'u-1',
        name: 'handbook',
      });
      if (!created.ok) {
        throw new Error('createCollection failed');
      }
      await writer.domainHandlers.addDocument({
        userId: 'u-1',
        collectionId: created.data.id,
        content: 'rag service chunks text into pieces',
      });

      const reader = resolve({ topK: 3, minScore: 0, hybridAlpha: 0 });
      const found = await reader.domainHandlers.retrieve({
        userId: 'u-1',
        collectionId: created.data.id,
        query: 'rag service chunks',
      });

      expect(found.ok).toBe(true);
      if (found.ok) {
        expect(found.data.length).toBeGreaterThan(0);
      }
    });

    it('re-applies a raised limit to the store that already holds the chunks', async () => {
      const deps = depsOf();
      const resolve = createRagRuntimeResolver(deps);

      const strict = resolve({ inMemoryMaxChunks: 1 });
      const strictCollection = await strict.domainHandlers.createCollection({
        userId: 'u-1',
        name: 'strict',
      });
      if (!strictCollection.ok) {
        throw new Error('createCollection failed');
      }
      const first = await strict.domainHandlers.addDocument({
        userId: 'u-1',
        collectionId: strictCollection.data.id,
        content: 'rag service chunks text into pieces',
      });
      if (!first.ok) {
        throw new Error('addDocument failed');
      }
      expect(first.data.chunkCount).toBeGreaterThan(0);
      const second = await strict.domainHandlers.addDocument({
        userId: 'u-1',
        collectionId: strictCollection.data.id,
        content: 'a second document that needs its own chunk budget',
      });
      expect(second.ok).toBe(false);
      if (!second.ok) {
        /** A configured ceiling is a typed `RagError`, so it is a 409 rather
         *  than an internal fault: the retry below succeeds unchanged once the
         *  limit is raised. */
        expect(second.status).toBe(409);
      }

      const relaxed = resolve({ inMemoryMaxChunks: 500 });
      const retry = await relaxed.domainHandlers.addDocument({
        userId: 'u-1',
        collectionId: strictCollection.data.id,
        content: 'a second document that needs its own chunk budget',
      });
      expect(retry.ok).toBe(true);
    });
  });
});
