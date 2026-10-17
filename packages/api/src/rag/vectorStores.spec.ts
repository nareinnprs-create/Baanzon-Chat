import type { VectorChunk } from './types';
import { InMemoryVectorStore } from './vectorStores';
import { RagError } from './errors';

function chunk(
  collectionId: string,
  documentId: string,
  chunkIndex: number,
  text: string,
): VectorChunk {
  return { collectionId, documentId, chunkIndex, text };
}

const found = async (
  store: InMemoryVectorStore,
  collectionId: string,
  query: string,
): Promise<string[]> => {
  const hits = await store.semanticSearch(collectionId, query, 50);
  return hits.map((c) => `${c.documentId}:${c.chunkIndex}`);
};

describe('InMemoryVectorStore', () => {
  describe('upsert', () => {
    it('replaces a chunk already stored at the same documentId and chunkIndex', async () => {
      const store = new InMemoryVectorStore();
      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'original alpha text'));

      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'replacement beta text'));

      const hits = await store.semanticSearch('c-1', 'beta', 10);
      expect(hits).toHaveLength(1);
      expect(hits[0].text).toBe('replacement beta text');
      expect(await found(store, 'c-1', 'original')).toEqual(['d-1:0']);
    });

    it('keeps a sibling chunk of the same document when only one index is replaced', async () => {
      const store = new InMemoryVectorStore();
      await store.upsertChunks('c-1', [
        chunk('c-1', 'd-1', 0, 'alpha first'),
        chunk('c-1', 'd-1', 1, 'alpha second'),
      ]);

      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'alpha revised first'));

      expect(await found(store, 'c-1', 'alpha')).toEqual(['d-1:1', 'd-1:0']);
      const hits = await store.semanticSearch('c-1', 'alpha', 10);
      expect(hits.map((c) => c.text).sort()).toEqual(['alpha revised first', 'alpha second']);
    });

    it('distinguishes two documents that share a chunkIndex', async () => {
      const store = new InMemoryVectorStore();
      await store.upsertChunks('c-1', [
        chunk('c-1', 'd-1', 0, 'alpha one'),
        chunk('c-1', 'd-2', 0, 'alpha two'),
      ]);

      expect((await found(store, 'c-1', 'alpha')).sort()).toEqual(['d-1:0', 'd-2:0']);
    });

    it('stores nothing for an empty chunk list', async () => {
      const store = new InMemoryVectorStore();
      await store.upsertChunks('c-1', []);
      expect(await store.semanticSearch('c-1', 'anything', 10)).toEqual([]);
    });
  });

  describe('deleteDocument', () => {
    it('removes every chunk of the document and reports how many it removed', async () => {
      const store = new InMemoryVectorStore();
      await store.upsertChunks('c-1', [
        chunk('c-1', 'd-1', 0, 'alpha one'),
        chunk('c-1', 'd-1', 1, 'alpha two'),
        chunk('c-1', 'd-2', 0, 'alpha three'),
      ]);

      const removed = await store.deleteDocument('c-1', 'd-1');

      expect(removed).toBe(2);
      expect(await found(store, 'c-1', 'alpha')).toEqual(['d-2:0']);
      const remaining = await store.semanticSearch('c-1', 'alpha', 10);
      expect(remaining.map((c) => c.text)).toEqual(['alpha three']);
    });

    it('drops the whole collection once the last document is deleted', async () => {
      const store = new InMemoryVectorStore({ maxCollections: 1 });
      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'alpha one'));

      expect(await store.deleteDocument('c-1', 'd-1')).toBe(1);

      // The emptied collection no longer occupies the single collection slot.
      await expect(
        store.upsertChunk('c-2', chunk('c-2', 'd-9', 0, 'beta one')),
      ).resolves.toBeUndefined();
    });

    it('keeps a collection that still holds other documents', async () => {
      const store = new InMemoryVectorStore({ maxCollections: 1 });
      await store.upsertChunks('c-1', [
        chunk('c-1', 'd-1', 0, 'alpha one'),
        chunk('c-1', 'd-2', 0, 'alpha two'),
      ]);

      expect(await store.deleteDocument('c-1', 'd-1')).toBe(1);

      expect(await found(store, 'c-1', 'alpha')).toEqual(['d-2:0']);
      await expect(store.upsertChunk('c-2', chunk('c-2', 'd-9', 0, 'beta'))).rejects.toThrow(
        /1 collections/,
      );
    });

    it('reports 0 for an unknown collection or document', async () => {
      const store = new InMemoryVectorStore();

      expect(await store.deleteDocument('missing', 'd-1')).toBe(0);

      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'alpha'));
      expect(await store.deleteDocument('c-1', 'd-404')).toBe(0);
      expect(await store.deleteDocument('missing', 'd-1')).toBe(0);
      expect(await found(store, 'c-1', 'alpha')).toEqual(['d-1:0']);
    });

    it('reports 0 on a second delete of the same document', async () => {
      const store = new InMemoryVectorStore();
      await store.upsertChunks('c-1', [
        chunk('c-1', 'd-1', 0, 'alpha one'),
        chunk('c-1', 'd-1', 1, 'alpha two'),
      ]);

      expect(await store.deleteDocument('c-1', 'd-1')).toBe(2);
      expect(await store.deleteDocument('c-1', 'd-1')).toBe(0);
    });
  });

  describe('deleteCollection', () => {
    it('removes every document in the collection and frees the collection slot', async () => {
      const store = new InMemoryVectorStore({ maxCollections: 1 });
      await store.upsertChunks('c-1', [
        chunk('c-1', 'd-1', 0, 'alpha one'),
        chunk('c-1', 'd-2', 0, 'alpha two'),
      ]);

      await store.deleteCollection('c-1');

      expect(await store.semanticSearch('c-1', 'alpha', 10)).toEqual([]);
      await expect(
        store.upsertChunk('c-2', chunk('c-2', 'd-9', 0, 'beta one')),
      ).resolves.toBeUndefined();
    });

    it('leaves other collections untouched', async () => {
      const store = new InMemoryVectorStore();
      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'alpha one'));
      await store.upsertChunk('c-2', chunk('c-2', 'd-2', 0, 'alpha two'));

      await store.deleteCollection('c-1');

      expect(await store.semanticSearch('c-1', 'alpha', 10)).toEqual([]);
      expect(await found(store, 'c-2', 'alpha')).toEqual(['d-2:0']);
    });

    it('is a no-op for an unknown collection', async () => {
      const store = new InMemoryVectorStore();
      await expect(store.deleteCollection('missing')).resolves.toBeUndefined();
    });
  });

  describe('countChunks', () => {
    it('reports 0 for a collection the store has never seen', async () => {
      const store = new InMemoryVectorStore();

      expect(await store.countChunks('missing')).toBe(0);
    });

    it('reports the chunks actually held, not a running total of every collection', async () => {
      const store = new InMemoryVectorStore();
      await store.upsertChunks('c-1', [
        chunk('c-1', 'd-1', 0, 'alpha one'),
        chunk('c-1', 'd-1', 1, 'alpha two'),
        chunk('c-1', 'd-2', 0, 'alpha three'),
      ]);
      await store.upsertChunk('c-2', chunk('c-2', 'd-1', 0, 'beta'));

      expect(await store.countChunks('c-1')).toBe(3);
      expect(await store.countChunks('c-2')).toBe(1);
    });

    it('does not double-count a chunk replaced in place', async () => {
      const store = new InMemoryVectorStore();
      await store.upsertChunks('c-1', [
        chunk('c-1', 'd-1', 0, 'alpha one'),
        chunk('c-1', 'd-1', 1, 'alpha two'),
      ]);

      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 1, 'alpha two revised'));

      expect(await store.countChunks('c-1')).toBe(2);
    });

    it('falls as the chunks are deleted, and returns to 0 when the collection empties', async () => {
      const store = new InMemoryVectorStore();
      await store.upsertChunks('c-1', [
        chunk('c-1', 'd-1', 0, 'alpha one'),
        chunk('c-1', 'd-2', 0, 'alpha two'),
      ]);

      expect(await store.deleteDocument('c-1', 'd-1')).toBe(1);
      expect(await store.countChunks('c-1')).toBe(1);

      expect(await store.deleteDocument('c-1', 'd-2')).toBe(1);
      expect(await store.countChunks('c-1')).toBe(0);
    });

    it('returns to 0 after the whole collection is deleted', async () => {
      const store = new InMemoryVectorStore();
      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'alpha'));

      await store.deleteCollection('c-1');

      expect(await store.countChunks('c-1')).toBe(0);
    });

    /**
     * A process-scoped index starts empty while the durable collection ledger
     * still holds its totals, so this is what the service has to report after a
     * restart: the count the index can serve.
     */
    it('reports 0 for a fresh store even where a previous process held chunks', async () => {
      const previous = new InMemoryVectorStore();
      await previous.upsertChunks('c-1', [
        chunk('c-1', 'd-1', 0, 'alpha one'),
        chunk('c-1', 'd-1', 1, 'alpha two'),
      ]);
      expect(await previous.countChunks('c-1')).toBe(2);

      const restarted = new InMemoryVectorStore();

      expect(await restarted.countChunks('c-1')).toBe(0);
    });
  });

  describe('capacity limits', () => {
    it('throws once the collection limit is reached', async () => {
      const store = new InMemoryVectorStore({ maxCollections: 2 });
      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'alpha'));
      await store.upsertChunk('c-2', chunk('c-2', 'd-2', 0, 'beta'));

      await expect(store.upsertChunk('c-3', chunk('c-3', 'd-3', 0, 'gamma'))).rejects.toThrow(
        /In-memory vector store is full \(2 collections\)/,
      );
    });

    it('does not count further chunks against an already admitted collection', async () => {
      const store = new InMemoryVectorStore({ maxCollections: 1 });
      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'alpha'));
      await expect(
        store.upsertChunk('c-1', chunk('c-1', 'd-1', 1, 'alpha again')),
      ).resolves.toBeUndefined();
    });

    it('throws when an upsert would cross the chunk limit', async () => {
      const store = new InMemoryVectorStore({ maxChunks: 2 });
      await store.upsertChunks('c-1', [
        chunk('c-1', 'd-1', 0, 'alpha'),
        chunk('c-1', 'd-1', 1, 'beta'),
      ]);

      await expect(store.upsertChunk('c-1', chunk('c-1', 'd-1', 2, 'gamma'))).rejects.toThrow(
        /In-memory vector store is full \(2 chunks\)/,
      );
    });

    it('leaves the store unchanged when a bulk upsert exceeds the chunk limit', async () => {
      const store = new InMemoryVectorStore({ maxChunks: 2 });
      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'alpha'));

      await expect(
        store.upsertChunks('c-1', [
          chunk('c-1', 'd-1', 1, 'beta'),
          chunk('c-1', 'd-1', 2, 'gamma'),
        ]),
      ).rejects.toThrow(/In-memory vector store is full \(2 chunks\)/);

      const texts = (await store.semanticSearch('c-1', 'alpha', 10)).map((c) => c.text);
      expect(texts).toEqual(['alpha']);
    });

    it('treats 0 as unlimited for both limits', async () => {
      const store = new InMemoryVectorStore({ maxCollections: 0, maxChunks: 0 });
      for (let i = 0; i < 50; i += 1) {
        await store.upsertChunk(`c-${i}`, chunk(`c-${i}`, 'd-1', 0, `alpha ${i}`));
      }
      expect(await found(store, 'c-49', 'alpha')).toEqual(['d-1:0']);
    });

    it('regression: re-ingesting the same document does not consume the chunk budget', async () => {
      const store = new InMemoryVectorStore({ maxChunks: 4 });
      const document = [chunk('c-1', 'd-1', 0, 'alpha one'), chunk('c-1', 'd-1', 1, 'alpha two')];
      await store.upsertChunks('c-1', document);

      for (let round = 0; round < 25; round += 1) {
        await expect(store.upsertChunks('c-1', document)).resolves.toBeUndefined();
      }

      const hits = await store.semanticSearch('c-1', 'alpha', 10);
      expect(hits).toHaveLength(2);
    });

    it('regression: a single re-upsert past the limit still replaces in place', async () => {
      const store = new InMemoryVectorStore({ maxChunks: 1 });
      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'alpha original'));

      for (let round = 0; round < 10; round += 1) {
        await expect(
          store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, `alpha revision ${round}`)),
        ).resolves.toBeUndefined();
      }

      const hits = await store.semanticSearch('c-1', 'alpha', 10);
      expect(hits).toHaveLength(1);
      expect(hits[0].text).toBe('alpha revision 9');
    });

    it('counts a genuinely new chunkIndex in an existing document against the limit', async () => {
      const store = new InMemoryVectorStore({ maxChunks: 2 });
      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'alpha'));

      await expect(
        store.upsertChunk('c-1', chunk('c-1', 'd-1', 1, 'beta')),
      ).resolves.toBeUndefined();
      await expect(store.upsertChunk('c-1', chunk('c-1', 'd-1', 2, 'gamma'))).rejects.toThrow(
        /full \(2 chunks\)/,
      );
    });

    it('counts a new document against the limit even when its text is identical', async () => {
      const store = new InMemoryVectorStore({ maxChunks: 1 });
      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'alpha'));

      await expect(store.upsertChunk('c-1', chunk('c-1', 'd-2', 0, 'alpha'))).rejects.toThrow(
        /full \(1 chunks\)/,
      );
    });

    /**
     * A typed error, so the HTTP layer can tell "this deployment is full" from
     * "the database is down" and pass the operator hint through instead of
     * swallowing it into a bare 500. A plain `Error` here would make the two
     * indistinguishable and leave nothing to back off on.
     */
    it('raises a typed 409 capacity error rather than an internal fault', async () => {
      const store = new InMemoryVectorStore({ maxChunks: 1 });
      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'alpha'));

      const error = await store
        .upsertChunk('c-1', chunk('c-1', 'd-1', 1, 'beta'))
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(RagError);
      expect((error as RagError).status).toBe(409);
      expect((error as RagError).message).toContain('inMemoryMaxChunks');
    });

    it('raises the same typed error for an exhausted collection ceiling', async () => {
      const store = new InMemoryVectorStore({ maxCollections: 1 });
      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'alpha'));

      const error = await store
        .upsertChunk('c-2', chunk('c-2', 'd-1', 0, 'beta'))
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(RagError);
      expect((error as RagError).status).toBe(409);
      expect((error as RagError).message).toContain('1 collections');
    });
  });

  describe('applyLimits', () => {
    it('replaces a chunk limit that is lower than the current usage', async () => {
      const store = new InMemoryVectorStore({ maxChunks: 0 });
      await store.upsertChunks('c-1', [
        chunk('c-1', 'd-1', 0, 'alpha'),
        chunk('c-1', 'd-1', 1, 'beta'),
      ]);

      store.applyLimits({ maxChunks: 1 });

      expect(await store.semanticSearch('c-1', 'alpha', 10)).toHaveLength(2);
      await expect(store.upsertChunk('c-1', chunk('c-1', 'd-1', 2, 'gamma'))).rejects.toThrow(
        /full \(1 chunks\)/,
      );
    });

    it('raises a chunk limit on a store that already holds chunks', async () => {
      const store = new InMemoryVectorStore({ maxChunks: 1 });
      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'alpha'));
      await expect(store.upsertChunk('c-1', chunk('c-1', 'd-1', 1, 'beta'))).rejects.toThrow();

      store.applyLimits({ maxChunks: 5 });

      await expect(
        store.upsertChunk('c-1', chunk('c-1', 'd-1', 1, 'beta')),
      ).resolves.toBeUndefined();
      expect(await store.semanticSearch('c-1', 'alpha', 10)).toHaveLength(2);
    });

    it('replaces a collection limit', async () => {
      const store = new InMemoryVectorStore();
      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'alpha'));

      store.applyLimits({ maxCollections: 1 });
      await expect(store.upsertChunk('c-2', chunk('c-2', 'd-2', 0, 'beta'))).rejects.toThrow(
        /full \(1 collections\)/,
      );

      store.applyLimits({ maxCollections: 3 });
      await expect(
        store.upsertChunk('c-2', chunk('c-2', 'd-2', 0, 'beta')),
      ).resolves.toBeUndefined();
    });

    it('leaves the stored chunks intact while swapping the limits', async () => {
      const store = new InMemoryVectorStore();
      await store.upsertChunks('c-1', [
        chunk('c-1', 'd-1', 0, 'alpha one'),
        chunk('c-1', 'd-2', 0, 'alpha two'),
      ]);

      store.applyLimits({ maxChunks: 1, maxCollections: 1 });

      expect((await found(store, 'c-1', 'alpha')).sort()).toEqual(['d-1:0', 'd-2:0']);
    });

    it('treats an omitted limit as unlimited', async () => {
      const store = new InMemoryVectorStore({ maxCollections: 1 });
      await store.upsertChunk('c-1', chunk('c-1', 'd-1', 0, 'alpha'));

      store.applyLimits({});

      await expect(
        store.upsertChunk('c-2', chunk('c-2', 'd-2', 0, 'beta')),
      ).resolves.toBeUndefined();
      await expect(
        store.upsertChunk('c-1', chunk('c-1', 'd-1', 1, 'gamma')),
      ).resolves.toBeUndefined();
    });
  });

  describe('semanticSearch', () => {
    it('orders candidates by token overlap and honours the limit', async () => {
      const store = new InMemoryVectorStore();
      await store.upsertChunks('c-1', [
        chunk('c-1', 'd-1', 0, 'alpha beta gamma delta'),
        chunk('c-1', 'd-2', 0, 'alpha'),
        chunk('c-1', 'd-3', 0, 'nothing shared here'),
      ]);

      const hits = await store.semanticSearch('c-1', 'alpha', 2);

      expect(hits.map((c) => c.documentId)).toEqual(['d-2', 'd-1']);
    });

    it('returns an empty list for an unknown collection', async () => {
      const store = new InMemoryVectorStore();
      expect(await store.semanticSearch('missing', 'alpha', 5)).toEqual([]);
    });
  });
});
