import type { KnowledgeCollection } from './types';
import { InMemoryVectorStore } from './vectorStores';
import { createRagService } from './service';

function makeService() {
  const ragCollections = new Map<string, KnowledgeCollection>();
  return createRagService({
    config: {
      chunkSize: 128,
      chunkOverlap: 12,
      hybridAlpha: 0.5,
      candidateK: 5,
      topK: 2,
      minScore: 0.2,
    },
    knowledgeStore: {
      createCollection: async (c: KnowledgeCollection) => {
        const col = c;
        ragCollections.set(col.id, col);
        return col;
      },
      listCollections: async () => [],
      getCollection: async (uid: string, id: string) => {
        const found = ragCollections.get(id);
        return found != null && found.userId === uid ? found : null;
      },
      updateCollection: async () => null,
      bumpCollectionStats: async (
        uid: string,
        id: string,
        delta: { documentDelta: number; chunkDelta: number },
      ) => {
        const found = ragCollections.get(id);
        if (found == null || found.userId !== uid) {
          return null;
        }
        // Read the counts and add the delta in the same synchronous step, with no
        // await in between — that is what the store's single `$inc` buys. Do not
        // "simplify" this into a read followed by an awaited write: that is the
        // read-modify-write race the delta exists to remove.
        const next = {
          ...found,
          documentCount: found.documentCount + delta.documentDelta,
          chunkCount: found.chunkCount + delta.chunkDelta,
        };
        ragCollections.set(id, next);
        return next;
      },
      deleteCollection: async () => true,
    } as never,
    vectorStore: new InMemoryVectorStore() as never,
  });
}

describe('rag service (B1.1)', () => {
  it('creates a private collection with default chunk settings inherited from config', async () => {
    const svc = makeService();
    const collection = await svc.createCollection({
      userId: 'u-1',
      name: 'docs',
      scope: 'private',
    });
    expect(collection.name).toBe('docs');
    expect(collection.scope).toBe('private');
    expect(collection.chunkSize).toBe(128);
    expect(collection.documentCount).toBe(0);
  });

  it('rejects an empty collection name', async () => {
    const svc = makeService();
    await expect(
      svc.createCollection({ userId: 'u-1', name: '', scope: 'private' }),
    ).rejects.toThrow();
  });

  it('adds a document, chunks it, and persists both chunk and document counts', async () => {
    const svc = makeService();
    const collection = await svc.createCollection({
      userId: 'u-1',
      name: 'handbook',
      scope: 'private',
    });
    const added = await svc.addDocument({
      userId: 'u-1',
      collectionId: collection.id,
      source: 'manual.txt',
      content: 'rag retrieves relevant chunks. rag chunks text into pieces.',
    });
    expect(added.chunkCount).toBeGreaterThan(0);
    expect(added.documentId).toBeTruthy();
  });

  it('counts up on ingest and back down on delete, as a signed delta', async () => {
    const svc = makeService();
    const collection = await svc.createCollection({
      userId: 'u-1',
      name: 'handbook',
      scope: 'private',
    });
    const added = await svc.addDocument({
      userId: 'u-1',
      collectionId: collection.id,
      source: 'manual.txt',
      content: 'rag retrieves relevant chunks. rag chunks text into pieces.',
    });

    const afterAdd = await svc.getCollection('u-1', collection.id);
    expect(afterAdd?.documentCount).toBe(1);
    expect(afterAdd?.chunkCount).toBe(added.chunkCount);

    expect(await svc.deleteDocument('u-1', collection.id, added.documentId)).toBe(true);

    const afterDelete = await svc.getCollection('u-1', collection.id);
    expect(afterDelete?.documentCount).toBe(0);
    expect(afterDelete?.chunkCount).toBe(0);
  });

  it('leaves the counters alone when deleting a document that was never ingested', async () => {
    const svc = makeService();
    const collection = await svc.createCollection({
      userId: 'u-1',
      name: 'handbook',
      scope: 'private',
    });
    const added = await svc.addDocument({
      userId: 'u-1',
      collectionId: collection.id,
      content: 'rag retrieves relevant chunks. rag chunks text into pieces.',
    });

    expect(await svc.deleteDocument('u-1', collection.id, 'not-a-real-document')).toBe(false);

    const unchanged = await svc.getCollection('u-1', collection.id);
    expect(unchanged?.documentCount).toBe(1);
    expect(unchanged?.chunkCount).toBe(added.chunkCount);
  });

  it('retrieves the most relevant snippet for a matching query', async () => {
    const svc = makeService();
    const collection = await svc.createCollection({
      userId: 'u-1',
      name: 'manual',
      scope: 'private',
    });
    await svc.addDocument({
      userId: 'u-1',
      collectionId: collection.id,
      source: 'manual.txt',
      content: 'The rag service chunks documents and scores chunks by token overlap.',
    });
    const snippets = await svc.retrieve({
      userId: 'u-1',
      collectionId: collection.id,
      query: 'rag service chunks',
      topK: 2,
      hybridAlpha: 0.5,
    });
    expect(snippets).not.toBeNull();
    expect(snippets?.length).toBeGreaterThan(0);
    expect(snippets?.[0].score).toBeGreaterThan(0);
  });

  it('denies reading a collection the user cannot access', async () => {
    const svc = makeService();
    const collection = await svc.createCollection({
      userId: 'u-1',
      name: 'private',
      scope: 'private',
    });
    const allowed = await svc.getCollection('u-2', collection.id);
    expect(allowed).toBeNull();
  });
});
