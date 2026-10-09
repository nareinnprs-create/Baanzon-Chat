import type { CollectionStatsDelta, KnowledgeCollection, KnowledgeStore } from './types';
import type { MongoKnowledgeStoreDeps } from './knowledgeStore';
import { createMongoKnowledgeStore } from './knowledgeStore';

const COLLECTION: KnowledgeCollection = {
  id: 'col-1',
  userId: 'u-1',
  name: 'handbook',
  description: 'team docs',
  scope: 'private',
  chunkSize: 800,
  chunkOverlap: 80,
  documentCount: 3,
  chunkCount: 11,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function makeDeps() {
  return {
    createKnowledgeCollection: jest.fn(async () => COLLECTION),
    getKnowledgeCollection: jest.fn(async () => COLLECTION),
    listKnowledgeCollections: jest.fn(async () => [COLLECTION]),
    updateKnowledgeCollection: jest.fn(async () => COLLECTION),
    bumpKnowledgeCollectionStats: jest.fn(
      async (_userId: string, _collectionId: string, _delta: CollectionStatsDelta) => COLLECTION,
    ),
    deleteKnowledgeCollection: jest.fn(async () => true),
  };
}

function makeStore(deps = makeDeps()): {
  store: KnowledgeStore;
  deps: ReturnType<typeof makeDeps>;
} {
  return { store: createMongoKnowledgeStore(deps as unknown as MongoKnowledgeStoreDeps), deps };
}

describe('createMongoKnowledgeStore', () => {
  it('delegates createCollection to createKnowledgeCollection with the collection as given', async () => {
    const { store, deps } = makeStore();

    const result = await store.createCollection(COLLECTION);

    expect(deps.createKnowledgeCollection).toHaveBeenCalledTimes(1);
    expect(deps.createKnowledgeCollection).toHaveBeenCalledWith(COLLECTION);
    expect(deps.createKnowledgeCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'col-1',
        userId: 'u-1',
        name: 'handbook',
        description: 'team docs',
        scope: 'private',
        chunkSize: 800,
        chunkOverlap: 80,
      }),
    );
    expect(result).toBe(COLLECTION);
  });

  it('delegates getCollection to getKnowledgeCollection with the user and collection ids', async () => {
    const { store, deps } = makeStore();

    const result = await store.getCollection('u-1', 'col-1');

    expect(deps.getKnowledgeCollection).toHaveBeenCalledWith('u-1', 'col-1');
    expect(result).toBe(COLLECTION);
  });

  it('delegates listCollections to listKnowledgeCollections with the user id only', async () => {
    const { store, deps } = makeStore();

    const result = await store.listCollections('u-1');

    expect(deps.listKnowledgeCollections).toHaveBeenCalledTimes(1);
    expect(deps.listKnowledgeCollections).toHaveBeenCalledWith('u-1');
    expect(deps.listKnowledgeCollections).not.toHaveBeenCalledWith('u-1', expect.anything());
    expect(result).toEqual([COLLECTION]);
  });

  it('delegates updateCollection to updateKnowledgeCollection with the ids and the patch', async () => {
    const { store, deps } = makeStore();
    const patch = { name: 'renamed', description: 'now described' };

    const result = await store.updateCollection('u-1', 'col-1', patch);

    expect(deps.updateKnowledgeCollection).toHaveBeenCalledWith('u-1', 'col-1', patch);
    expect(result).toBe(COLLECTION);
  });

  it('forwards the updatedAt stamp the service adds alongside the patch', async () => {
    const store = makeStore();

    // `global`, not the retired `project`: the scope here is filler that only
    // has to be a field the patch carries, and `CollectionScope` no longer
    // names a value the store could legitimately be handed.
    await store.store.updateCollection('u-1', 'col-1', { scope: 'global', updatedAt: 'later' });

    expect(store.deps.updateKnowledgeCollection).toHaveBeenCalledWith('u-1', 'col-1', {
      scope: 'global',
      updatedAt: 'later',
    });
  });

  /**
   * The counters move only through `bumpCollectionStats`. Widening this patch
   * back to accept them would let a caller write one absolutely and lose a
   * concurrent ingest's increment, so the invariant is asserted where it lives:
   * in the patch type. `PATCH_HAS_NO_COUNTERS` is `never` the moment a counter
   * reappears, which fails `tsc --noEmit` rather than a test run nobody watches.
   */
  it('takes no ingest counter on its patch', () => {
    type Patch = Parameters<KnowledgeStore['updateCollection']>[2];
    type HasNoCounter<K extends string> = K extends keyof Patch ? never : true;

    const patchHasNoDocumentCount: HasNoCounter<'documentCount'> = true;
    const patchHasNoChunkCount: HasNoCounter<'chunkCount'> = true;

    expect(patchHasNoDocumentCount).toBe(true);
    expect(patchHasNoChunkCount).toBe(true);
  });

  it('delegates bumpCollectionStats to bumpKnowledgeCollectionStats with the ids and the delta', async () => {
    const { store, deps } = makeStore();
    const delta: CollectionStatsDelta = { documentDelta: -1, chunkDelta: -4 };

    const result = await store.bumpCollectionStats('u-1', 'col-1', delta);

    expect(deps.bumpKnowledgeCollectionStats).toHaveBeenCalledTimes(1);
    expect(deps.bumpKnowledgeCollectionStats).toHaveBeenCalledWith('u-1', 'col-1', delta);
    /** Identity, not a copy: the delta's sign is the whole point of the call, so
     *  an adapter that rebuilt the object could invert a deletion into an ingest. */
    expect(deps.bumpKnowledgeCollectionStats.mock.calls[0][2]).toBe(delta);
    expect(result).toBe(COLLECTION);
  });

  it('passes the signed delta through without dropping or zeroing a field', async () => {
    const { store, deps } = makeStore();

    await store.bumpCollectionStats('u-1', 'col-1', { documentDelta: 0, chunkDelta: 7 });

    expect(deps.bumpKnowledgeCollectionStats.mock.calls[0][2]).toEqual({
      documentDelta: 0,
      chunkDelta: 7,
    });
  });

  it('delegates deleteCollection to deleteKnowledgeCollection with the ids', async () => {
    const { store, deps } = makeStore();

    const result = await store.deleteCollection('u-1', 'col-1');

    expect(deps.deleteKnowledgeCollection).toHaveBeenCalledWith('u-1', 'col-1');
    expect(result).toBe(true);
  });

  it('passes a null getCollection result straight through', async () => {
    const deps = makeDeps();
    deps.getKnowledgeCollection.mockResolvedValue(null as never);
    const { store } = makeStore(deps);

    expect(await store.getCollection('u-1', 'missing')).toBeNull();
  });

  it('passes a null updateCollection result straight through', async () => {
    const deps = makeDeps();
    deps.updateKnowledgeCollection.mockResolvedValue(null as never);
    const { store } = makeStore(deps);

    expect(await store.updateCollection('u-1', 'missing', { name: 'x' })).toBeNull();
  });

  it('passes a null bumpCollectionStats result straight through', async () => {
    const deps = makeDeps();
    deps.bumpKnowledgeCollectionStats.mockResolvedValue(null as never);
    const { store } = makeStore(deps);

    expect(
      await store.bumpCollectionStats('u-1', 'missing', { documentDelta: 1, chunkDelta: 2 }),
    ).toBeNull();
  });

  it('passes a false deleteCollection result straight through', async () => {
    const deps = makeDeps();
    deps.deleteKnowledgeCollection.mockResolvedValue(false);
    const { store } = makeStore(deps);

    expect(await store.deleteCollection('u-1', 'missing')).toBe(false);
  });

  it('exposes exactly the six KnowledgeStore methods', () => {
    const { store } = makeStore();

    expect(Object.keys(store).sort()).toEqual([
      'bumpCollectionStats',
      'createCollection',
      'deleteCollection',
      'getCollection',
      'listCollections',
      'updateCollection',
    ]);
  });

  it('does not reach for a data-schemas singleton at call time', async () => {
    const deps = makeDeps();
    const { store } = makeStore(deps);

    await store.getCollection('u-1', 'col-1');
    await store.listCollections('u-1');

    expect(deps.getKnowledgeCollection).toHaveBeenCalledTimes(1);
    expect(deps.listKnowledgeCollections).toHaveBeenCalledTimes(1);
  });
});
