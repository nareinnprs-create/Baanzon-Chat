import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IKnowledgeCollectionDoc, KnowledgeCollectionPatch } from '~/types/knowledge';
import type { KnowledgeCollectionMethods } from './knowledgeCollection';
import {
  createKnowledgeCollectionMethods,
  KNOWLEDGE_COLLECTION_LIST_LIMIT,
} from './knowledgeCollection';
import { KNOWLEDGE_COLLECTION_NAME } from '~/schema/knowledgeCollection';
import { tenantStorage } from '~/config/tenantContext';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let methods: KnowledgeCollectionMethods;
let model: mongoose.Model<IKnowledgeCollectionDoc>;

const OWNER = 'user-1';
const STRANGER = 'user-2';

const baseInput = (overrides: Record<string, unknown> = {}) => ({
  id: 'col-1',
  userId: OWNER,
  name: 'handbook',
  scope: 'private' as const,
  chunkSize: 800,
  chunkOverlap: 80,
  ...overrides,
});

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  Object.assign(mongoose.models, createModels(mongoose));
  await mongoose.connect(mongoServer.getUri());
  methods = createKnowledgeCollectionMethods(mongoose);
  model = mongoose.models[KNOWLEDGE_COLLECTION_NAME] as mongoose.Model<IKnowledgeCollectionDoc>;
  // Build the unique `{ id: 1 }` index up front so the duplicate-id case does
  // not race Mongoose's background index build.
  await model.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await model.deleteMany({});
});

describe('createKnowledgeCollectionMethods', () => {
  describe('createKnowledgeCollection', () => {
    it('persists the collection with zeroed counters and ISO timestamps', async () => {
      const created = await methods.createKnowledgeCollection(baseInput());

      expect(created).toEqual({
        id: 'col-1',
        userId: OWNER,
        name: 'handbook',
        description: undefined,
        scope: 'private',
        chunkSize: 800,
        chunkOverlap: 80,
        documentCount: 0,
        chunkCount: 0,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false);
    });

    it('does not let the caller seed the counters', async () => {
      await methods.createKnowledgeCollection(
        baseInput({ documentCount: 99, chunkCount: 99 }) as never,
      );

      const read = await methods.getKnowledgeCollection(OWNER, 'col-1');
      expect(read?.documentCount).toBe(0);
      expect(read?.chunkCount).toBe(0);
    });

    it('rejects a second collection with the same id', async () => {
      await methods.createKnowledgeCollection(baseInput());

      await expect(methods.createKnowledgeCollection(baseInput({ name: 'other' }))).rejects.toThrow(
        /duplicate key/i,
      );
    });
  });

  describe('getKnowledgeCollection', () => {
    it('returns the owner collection as a plain object, not a Mongoose document', async () => {
      await methods.createKnowledgeCollection(baseInput());

      const found = await methods.getKnowledgeCollection(OWNER, 'col-1');

      expect(found).not.toBeNull();
      expect(found).not.toHaveProperty('_id');
      expect(found?.id).toBe('col-1');
    });

    it('returns null for an unknown id', async () => {
      expect(await methods.getKnowledgeCollection(OWNER, 'nope')).toBeNull();
    });

    it('hides a private collection from other users', async () => {
      await methods.createKnowledgeCollection(baseInput());

      expect(await methods.getKnowledgeCollection(STRANGER, 'col-1')).toBeNull();
    });

    it('exposes a global collection to other users', async () => {
      await methods.createKnowledgeCollection(baseInput({ scope: 'global' }));

      expect(await methods.getKnowledgeCollection(STRANGER, 'col-1')).not.toBeNull();
    });
  });

  describe('listKnowledgeCollections', () => {
    it('lists owned collections plus global ones, newest first', async () => {
      await methods.createKnowledgeCollection(baseInput({ id: 'col-old', name: 'old' }));
      await methods.createKnowledgeCollection(baseInput({ id: 'col-new', name: 'new' }));
      await methods.createKnowledgeCollection(
        baseInput({ id: 'col-global', name: 'global', scope: 'global' }),
      );
      await methods.updateKnowledgeCollection(OWNER, 'col-old', {
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      await methods.updateKnowledgeCollection(OWNER, 'col-new', {
        updatedAt: '2026-02-01T00:00:00.000Z',
      });

      const listed = await methods.listKnowledgeCollections(OWNER);

      expect(listed.map((c) => c.id)).toEqual(['col-global', 'col-new', 'col-old']);
    });

    it('never lists another user private collection', async () => {
      await methods.createKnowledgeCollection(baseInput({ id: 'col-mine' }));
      await methods.createKnowledgeCollection(
        baseInput({ id: 'col-theirs', userId: STRANGER, name: 'theirs' }),
      );

      const listed = await methods.listKnowledgeCollections(OWNER);

      expect(listed.map((c) => c.id)).toEqual(['col-mine']);
    });

    it('honours the limit argument', async () => {
      await methods.createKnowledgeCollection(baseInput({ id: 'col-a' }));
      await methods.createKnowledgeCollection(baseInput({ id: 'col-b' }));

      expect(await methods.listKnowledgeCollections(OWNER, 1)).toHaveLength(1);
    });

    it('returns an empty list for a user with nothing stored', async () => {
      expect(await methods.listKnowledgeCollections('user-nobody')).toEqual([]);
    });

    it('defaults to the exported page size, so the cap is one referenced number', async () => {
      // The cap used to be a literal in this signature, where nothing could read
      // it: the response gave no way to say a page had stopped short, and the
      // only record of the limit was the line that applied it. Called with no
      // limit, the page is exactly `KNOWLEDGE_COLLECTION_LIST_LIMIT` long.
      const total = KNOWLEDGE_COLLECTION_LIST_LIMIT + 5;
      await Promise.all(
        Array.from({ length: total }, (_unused, index) =>
          methods.createKnowledgeCollection(baseInput({ id: `col-${index}` })),
        ),
      );

      const listed = await methods.listKnowledgeCollections(OWNER);

      expect(listed).toHaveLength(KNOWLEDGE_COLLECTION_LIST_LIMIT);
      // The page alone cannot tell this from a complete list, which is what
      // makes the count beside it load-bearing rather than decorative.
      expect(await methods.countKnowledgeCollections(OWNER)).toBe(total);
    });
  });

  /**
   * The count is what makes a capped list honest, so it is held to the same
   * visibility rule the list is: two methods that disagreed about who owns a
   * collection would put a total beside a page drawn from a different set.
   */
  describe('countKnowledgeCollections', () => {
    it('counts owned collections plus global ones', async () => {
      await methods.createKnowledgeCollection(baseInput({ id: 'col-mine' }));
      await methods.createKnowledgeCollection(baseInput({ id: 'col-mine-2' }));
      await methods.createKnowledgeCollection(baseInput({ id: 'col-global', scope: 'global' }));

      expect(await methods.countKnowledgeCollections(OWNER)).toBe(3);
    });

    it('counts another user private collection for neither of them', async () => {
      await methods.createKnowledgeCollection(baseInput({ id: 'col-theirs', userId: STRANGER }));

      expect(await methods.countKnowledgeCollections(OWNER)).toBe(0);
      expect(await methods.countKnowledgeCollections(STRANGER)).toBe(1);
    });

    it('is 0 for a user with nothing stored', async () => {
      expect(await methods.countKnowledgeCollections('user-nobody')).toBe(0);
    });

    it('follows a delete, so a freed slot shows up as a smaller total', async () => {
      await methods.createKnowledgeCollection(baseInput({ id: 'col-a' }));
      await methods.createKnowledgeCollection(baseInput({ id: 'col-b' }));
      expect(await methods.countKnowledgeCollections(OWNER)).toBe(2);

      expect(await methods.deleteKnowledgeCollection(OWNER, 'col-a')).toBe(true);

      expect(await methods.countKnowledgeCollections(OWNER)).toBe(1);
    });

    it('does not count a collection the caller can only read', async () => {
      await methods.createKnowledgeCollection(baseInput({ id: 'col-theirs', userId: STRANGER }));

      // A count of another user's row would put a total in `u-1`'s response that
      // no collection on the page accounts for.
      expect(await methods.countKnowledgeCollections(OWNER)).toBe(0);
    });
  });

  describe('updateKnowledgeCollection', () => {
    it('applies the patch to the owner collection', async () => {
      await methods.createKnowledgeCollection(baseInput());

      const updated = await methods.updateKnowledgeCollection(OWNER, 'col-1', {
        name: 'renamed',
        description: 'team docs',
        scope: 'global',
      });

      expect(updated?.name).toBe('renamed');
      expect(updated?.description).toBe('team docs');
      expect(updated?.scope).toBe('global');
    });

    it('leaves the ingest counters alone: a patch carries no counter to move them', async () => {
      await methods.createKnowledgeCollection(baseInput());
      await methods.bumpKnowledgeCollectionStats(OWNER, 'col-1', {
        documentDelta: 2,
        chunkDelta: 7,
      });

      const updated = await methods.updateKnowledgeCollection(OWNER, 'col-1', { name: 'renamed' });

      expect(updated?.documentCount).toBe(2);
      expect(updated?.chunkCount).toBe(7);
    });

    /**
     * The runtime half of the create path's own defence, and the case the
     * `KnowledgeCollectionPatch` type could not cover: `findOneAndUpdate` used
     * to be handed the patch whole, so whatever keys it carried were `$set`. The
     * counters were reachable that way no matter what the type said, and a
     * widened patch type or a re-spread document at a call site would have
     * written them.
     */
    it('does not let a patch move the counters, even when the patch carries them', async () => {
      await methods.createKnowledgeCollection(baseInput());
      await methods.bumpKnowledgeCollectionStats(OWNER, 'col-1', {
        documentDelta: 2,
        chunkDelta: 7,
      });

      const updated = await methods.updateKnowledgeCollection(OWNER, 'col-1', {
        name: 'renamed',
        documentCount: 99,
        chunkCount: 99,
      } as never);

      expect(updated?.name).toBe('renamed');
      expect(updated?.documentCount).toBe(2);
      expect(updated?.chunkCount).toBe(7);
    });

    it('does not let a patch re-own the collection or change its id', async () => {
      await methods.createKnowledgeCollection(baseInput());

      const updated = await methods.updateKnowledgeCollection(OWNER, 'col-1', {
        id: 'col-hijacked',
        userId: STRANGER,
      } as never);

      // `id` and `userId` are the filter of the very write that would move them,
      // so a patch allowed to set them could take a collection out from under
      // its owner and lock that owner out of it.
      expect(updated?.id).toBe('col-1');
      expect(updated?.userId).toBe(OWNER);
      expect(await methods.getKnowledgeCollection(STRANGER, 'col-1')).toBeNull();
    });

    it('refuses a scope the schema enum no longer accepts', async () => {
      await methods.createKnowledgeCollection(baseInput());

      // `runValidators` is what makes the schema's `enum` a write constraint
      // here rather than a comment: `create` refuses this value, and a patch
      // naming it used to be `$set` straight through.
      await expect(
        methods.updateKnowledgeCollection(OWNER, 'col-1', { scope: 'project' } as never),
      ).rejects.toThrow(/enumerated|enum/i);

      // A rejected write leaves the stored scope alone: no row gains a value no
      // type in this package admits.
      expect((await methods.getKnowledgeCollection(OWNER, 'col-1'))?.scope).toBe('private');
    });

    it('sends only the allowlisted fields, and asks the schema to validate them', async () => {
      await methods.createKnowledgeCollection(baseInput());
      const findOneAndUpdate = jest.spyOn(model, 'findOneAndUpdate');

      await methods.updateKnowledgeCollection(OWNER, 'col-1', {
        name: 'renamed',
        description: 'team docs',
        scope: 'global',
        updatedAt: '2026-02-01T00:00:00.000Z',
        id: 'col-2',
        userId: STRANGER,
        chunkSize: 1,
        chunkOverlap: 0,
        documentCount: 4,
        chunkCount: 4,
      } as never);

      const [, update, options] = findOneAndUpdate.mock.calls[0] as unknown as [
        Record<string, unknown>,
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      findOneAndUpdate.mockRestore();

      // Pinned by what reaches the wire rather than by a comment, because the
      // allowlist *is* the defence: every field of the collection that is not
      // editable after creation is absent from the `$set`, and the write is
      // validated instead of trusted.
      expect(Object.keys(update.$set as Record<string, unknown>).sort()).toEqual([
        'description',
        'name',
        'scope',
        'updatedAt',
      ]);
      expect(options).toMatchObject({ runValidators: true });
    });

    /**
     * A compile-time guard, and *only* a compile-time guard. `packages/data-schemas`
     * builds with `tsdown`, which emits without typechecking, and Jest runs
     * through `ts-jest`/`babel` without checking types either — so this line is
     * enforced by `npx tsc --noEmit` alone and **cannot** fail
     * `npx jest src/methods/knowledgeCollection`. The assertion below it is a
     * placeholder to keep the file valid, not coverage of anything.
     *
     * It is kept because it fails the typecheck the moment a counter reappears
     * in `KnowledgeCollectionPatch`, and because the type is the first of the
     * two defences rather than the only one. The rule itself is enforced at
     * runtime by the allowlist tests above, which run under Jest; this is the
     * early warning, and it should not be read as the thing that holds the line.
     */
    it('keeps absolute counter writes out of the patch type (tsc enforces this, jest cannot)', () => {
      const patch: KnowledgeCollectionPatch = {
        name: 'renamed',
        // @ts-expect-error: counters are reachable only through
        // `bumpKnowledgeCollectionStats`; re-adding them to
        // `KnowledgeCollectionPatch` must fail this file's typecheck.
        documentCount: 4,
      };

      expect(patch.name).toBe('renamed');
    });

    it('leaves untouched fields alone', async () => {
      await methods.createKnowledgeCollection(baseInput({ description: 'team docs' }));

      const updated = await methods.updateKnowledgeCollection(OWNER, 'col-1', { name: 'renamed' });

      expect(updated?.name).toBe('renamed');
      expect(updated?.description).toBe('team docs');
      expect(updated?.chunkSize).toBe(800);
    });

    it('returns null for a non-owner even when the collection exists', async () => {
      await methods.createKnowledgeCollection(baseInput({ scope: 'global' }));

      expect(
        await methods.updateKnowledgeCollection(STRANGER, 'col-1', { name: 'hijacked' }),
      ).toBeNull();
      const read = await methods.getKnowledgeCollection(OWNER, 'col-1');
      expect(read?.name).toBe('handbook');
    });

    it('returns null for an unknown id', async () => {
      expect(await methods.updateKnowledgeCollection(OWNER, 'nope', { name: 'x' })).toBeNull();
    });
  });

  /**
   * The one function the durability guarantee rests on, against a real Mongo.
   *
   * Everything else here is bookkeeping; this is the only place a counter moves,
   * so it is the only place a lost increment can be introduced. A mocked model
   * cannot demonstrate that: a mock that adds the delta in JavaScript is
   * trivially safe, and proves nothing about what is sent to the server.
   */
  describe('bumpKnowledgeCollectionStats', () => {
    const WRITERS = 12;
    const CHUNKS_PER_WRITER = 5;

    it('applies the delta to both counters and returns the new document', async () => {
      await methods.createKnowledgeCollection(baseInput());

      const bumped = await methods.bumpKnowledgeCollectionStats(OWNER, 'col-1', {
        documentDelta: 1,
        chunkDelta: 3,
      });

      expect(bumped?.documentCount).toBe(1);
      expect(bumped?.chunkCount).toBe(3);
      expect(bumped?.id).toBe('col-1');
    });

    it('sums concurrent increments with no lost update', async () => {
      await methods.createKnowledgeCollection(baseInput());

      // Issued without awaiting between them, so the driver has all WRITERS
      // updates in flight against the one document at the same time. A
      // read-modify-write implementation loses increments here; a single
      // `$inc` cannot, because the arithmetic happens on the server.
      const results = await Promise.all(
        Array.from({ length: WRITERS }, () =>
          methods.bumpKnowledgeCollectionStats(OWNER, 'col-1', {
            documentDelta: 1,
            chunkDelta: CHUNKS_PER_WRITER,
          }),
        ),
      );

      expect(results.every((result) => result != null)).toBe(true);
      const after = await methods.getKnowledgeCollection(OWNER, 'col-1');
      expect(after?.documentCount).toBe(WRITERS);
      expect(after?.chunkCount).toBe(WRITERS * CHUNKS_PER_WRITER);
    });

    it('regression: shows what the concurrency test above is guarding against', async () => {
      await methods.createKnowledgeCollection(baseInput());
      const read = () => model.findOne({ id: 'col-1', userId: OWNER }).lean().exec();
      const writeAbsolute = (documentCount: number, chunkCount: number) =>
        model
          .updateOne({ id: 'col-1', userId: OWNER }, { $set: { documentCount, chunkCount } })
          .exec();

      // Two writers, both holding the same snapshot: the second absolute write
      // clobbers the first one's committed increment. Pinned so the concurrency
      // test above is not vacuous — this is the same collection, the same two
      // deltas, and it loses 1 of 2 documents and 5 of 10 chunks, which is what
      // a read-modify-write `bumpKnowledgeCollectionStats` would make of it.
      const snapshotA = await read();
      const snapshotB = await read();
      await writeAbsolute((snapshotA?.documentCount ?? 0) + 1, (snapshotA?.chunkCount ?? 0) + 5);
      await writeAbsolute((snapshotB?.documentCount ?? 0) + 1, (snapshotB?.chunkCount ?? 0) + 5);

      const after = await model.findOne({ id: 'col-1' }).lean().exec();
      expect(after?.documentCount).toBe(1);
      expect(after?.chunkCount).toBe(5);
    });

    it('issues one $inc for both counters and never a $set of either', async () => {
      await methods.createKnowledgeCollection(baseInput());
      const findOneAndUpdate = jest.spyOn(model, 'findOneAndUpdate');

      await methods.bumpKnowledgeCollectionStats(OWNER, 'col-1', {
        documentDelta: 1,
        chunkDelta: 3,
      });

      const [filter, update] = (
        findOneAndUpdate.mock.calls as unknown as [
          Record<string, unknown>,
          Record<string, unknown>,
        ][]
      )[0];
      // The owner filter is the whole reason a bump cannot be applied to
      // somebody else's collection, and it rides on the same call.
      expect(filter).toEqual({ id: 'col-1', userId: OWNER });
      expect(update.$inc).toEqual({ documentCount: 1, chunkCount: 3 });
      expect(Object.keys((update.$set ?? {}) as Record<string, unknown>)).toEqual(['updatedAt']);
    });

    it('moves updatedAt forward, so a bump reorders a listing', async () => {
      await methods.createKnowledgeCollection(baseInput());
      await methods.updateKnowledgeCollection(OWNER, 'col-1', {
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const bumped = await methods.bumpKnowledgeCollectionStats(OWNER, 'col-1', {
        documentDelta: 1,
        chunkDelta: 1,
      });

      expect(new Date(bumped?.updatedAt ?? '').getTime()).toBeGreaterThan(
        Date.parse('2026-01-01T00:00:00.000Z'),
      );
    });

    it('refuses a non-owner: the bump is owner-only even for a global collection', async () => {
      await methods.createKnowledgeCollection(baseInput({ scope: 'global' }));

      expect(
        await methods.bumpKnowledgeCollectionStats(STRANGER, 'col-1', {
          documentDelta: 1,
          chunkDelta: 3,
        }),
      ).toBeNull();
      const read = await methods.getKnowledgeCollection(OWNER, 'col-1');
      expect(read?.documentCount).toBe(0);
      expect(read?.chunkCount).toBe(0);
    });

    it('returns null for a collection that does not exist, and does not create one', async () => {
      expect(
        await methods.bumpKnowledgeCollectionStats(OWNER, 'ghost', {
          documentDelta: 1,
          chunkDelta: 3,
        }),
      ).toBeNull();
      // `null` is the signal the service reports as "its counters did not move",
      // so the bump must not resurrect the collection it was aimed at.
      expect(await model.countDocuments({ id: 'ghost' })).toBe(0);
    });

    it('applies a negative delta to a collection that has them', async () => {
      await methods.createKnowledgeCollection(baseInput());
      await methods.bumpKnowledgeCollectionStats(OWNER, 'col-1', {
        documentDelta: 2,
        chunkDelta: 7,
      });

      const bumped = await methods.bumpKnowledgeCollectionStats(OWNER, 'col-1', {
        documentDelta: -2,
        chunkDelta: -7,
      });

      expect(bumped?.documentCount).toBe(0);
      expect(bumped?.chunkCount).toBe(0);
    });

    it('finding: a negative delta is not clamped at zero, so it can drive a counter negative', async () => {
      await methods.createKnowledgeCollection(baseInput());

      const bumped = await methods.bumpKnowledgeCollectionStats(OWNER, 'col-1', {
        documentDelta: -1,
        chunkDelta: -1,
      });

      // Documented, not endorsed: nothing in the method or the schema floors
      // these at zero, and the caller — `deleteDocument` — only ever decrements
      // by a chunk count the vector store actually removed, so the real path
      // cannot underflow. Any other caller can, and a negative count is
      // reported to the client as if it were a count.
      expect(bumped?.documentCount).toBe(-1);
      expect(bumped?.chunkCount).toBe(-1);
    });
  });

  describe('deleteKnowledgeCollection', () => {
    it('removes the owner collection and reports true', async () => {
      await methods.createKnowledgeCollection(baseInput());

      expect(await methods.deleteKnowledgeCollection(OWNER, 'col-1')).toBe(true);
      expect(await methods.getKnowledgeCollection(OWNER, 'col-1')).toBeNull();
    });

    it('reports false for a non-owner and keeps the collection', async () => {
      await methods.createKnowledgeCollection(baseInput({ scope: 'global' }));

      expect(await methods.deleteKnowledgeCollection(STRANGER, 'col-1')).toBe(false);
      expect(await methods.getKnowledgeCollection(OWNER, 'col-1')).not.toBeNull();
    });

    it('reports false for an unknown id', async () => {
      expect(await methods.deleteKnowledgeCollection(OWNER, 'nope')).toBe(false);
    });

    it('reports false on a second delete of the same id', async () => {
      await methods.createKnowledgeCollection(baseInput());

      expect(await methods.deleteKnowledgeCollection(OWNER, 'col-1')).toBe(true);
      expect(await methods.deleteKnowledgeCollection(OWNER, 'col-1')).toBe(false);
    });
  });

  /**
   * A row a deployment wrote before `project` was refused, checked against a
   * real Mongo rather than the in-memory `Map` the api-layer tests use. That
   * substitution is why this gap existed: a `Map` cannot observe Mongoose's
   * `enum`, cannot see what `.lean()` returns, and answers every visibility
   * question with the same hand-written predicate the production filter is
   * compared against. So the claim under audit — that retiring the value needed
   * no migration because such a row was always owner-only — was true as written
   * and untested.
   *
   * The row is inserted through the raw driver because every Mongoose write path
   * refuses the value now: `create` validates the enum, and
   * `updateKnowledgeCollection` runs `runValidators`. Bypassing the model is the
   * only way to reproduce the row this is about, and it is also the strongest
   * statement of the claim — the value cannot be re-created through any API.
   *
   * Tenant ids are in play because this schema carries
   * `applyTenantIsolation`, and "invisible across tenants" is only a real
   * assertion inside a tenant context: unscoped (as the rest of this file runs),
   * the tenant filter is not applied at all and the third case would pass for
   * the wrong reason.
   */
  describe('a row stored with the retired project scope', () => {
    const TENANT_A = 'tenant-a';
    const TENANT_B = 'tenant-b';
    const LEGACY_ID = 'col-legacy';

    /** Raw insert: no casting, no validation, exactly what an older build wrote. */
    const insertLegacyRow = (): Promise<unknown> =>
      model.collection.insertOne({
        id: LEGACY_ID,
        userId: OWNER,
        name: 'written before the refusal',
        scope: 'project',
        chunkSize: 800,
        chunkOverlap: 80,
        documentCount: 1,
        chunkCount: 3,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        tenantId: TENANT_A,
      });

    /** Async by necessity: the tenant context propagates through Mongoose's thenable. */
    const asTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
      tenantStorage.run({ tenantId }, fn);

    beforeEach(async () => {
      await insertLegacyRow();
    });

    it('is readable by its owner, with the stored scope handed back unrewritten', async () => {
      const found = await asTenant(TENANT_A, () =>
        methods.getKnowledgeCollection(OWNER, LEGACY_ID),
      );

      expect(found).not.toBeNull();
      // Not coerced to `private` on the way out: `toPlain` re-types the Mongoose
      // string and a read that rewrote it would be a data change disguised as a
      // read. The stored value is what the owner is shown.
      expect(found?.scope).toBe('project');
      expect(found?.documentCount).toBe(1);
      expect(found?.chunkCount).toBe(3);
    });

    it('is invisible to another user in the same tenant', async () => {
      await expect(
        asTenant(TENANT_A, () => methods.getKnowledgeCollection(STRANGER, LEGACY_ID)),
      ).resolves.toBeNull();
      // The other user is in the same tenant, so the tenant filter is not what
      // hides it — `$or: [{ userId }, { scope: 'global' }]` is, matching the
      // `userId` branch and neither branch of the `global` half.
      const listed = await asTenant(TENANT_A, () => methods.listKnowledgeCollections(STRANGER));
      expect(listed).toEqual([]);
      expect(await asTenant(TENANT_A, () => methods.countKnowledgeCollections(STRANGER))).toBe(0);
    });

    it('is invisible across tenants, even to the same user id', async () => {
      // The owner asking again is the only form of this case that isolates
      // anything: the `userId` branch of `visibleToUser` matches, so the tenant
      // filter is the single reason the row cannot be seen.
      await expect(
        asTenant(TENANT_B, () => methods.getKnowledgeCollection(OWNER, LEGACY_ID)),
      ).resolves.toBeNull();
      expect(await asTenant(TENANT_B, () => methods.listKnowledgeCollections(OWNER))).toEqual([]);
      expect(await asTenant(TENANT_B, () => methods.countKnowledgeCollections(OWNER))).toBe(0);
    });

    it('is still listed for its owner, so the retired value hides nothing', async () => {
      // A list that filtered on the scope vocabulary would drop this row without
      // saying so, which is the one failure mode a write-time narrowing creates
      // on the read side. `visibleToUser` matches the `userId` branch, so it does
      // not, and the listing still counts the row the owner can open.
      const listed = await asTenant(TENANT_A, () => methods.listKnowledgeCollections(OWNER));

      expect(listed.map((c) => c.id)).toEqual([LEGACY_ID]);
      expect(await asTenant(TENANT_A, () => methods.countKnowledgeCollections(OWNER))).toBe(1);
    });

    it('is still editable and migratable by its owner, which is why no migration is needed', async () => {
      // `runValidators` validates the fields the update writes, not the ones
      // already stored, so a narrowing write-time constraint cannot lock a
      // legacy row out of the one-way operation that retires it.
      const renamed = await asTenant(TENANT_A, () =>
        methods.updateKnowledgeCollection(OWNER, LEGACY_ID, { name: 'renamed' }),
      );
      expect(renamed?.name).toBe('renamed');
      expect(renamed?.scope).toBe('project');

      const migrated = await asTenant(TENANT_A, () =>
        methods.updateKnowledgeCollection(OWNER, LEGACY_ID, { scope: 'private' }),
      );
      expect(migrated?.scope).toBe('private');
      expect(migrated?.name).toBe('renamed');
    });

    it('cannot be patched back to the retired scope', async () => {
      await expect(
        asTenant(TENANT_A, () =>
          methods.updateKnowledgeCollection(OWNER, LEGACY_ID, { scope: 'project' } as never),
        ),
      ).rejects.toThrow(/enumerated|enum/i);

      // Refused, and the row is left as it was rather than half-migrated.
      const read = await asTenant(TENANT_A, () => methods.getKnowledgeCollection(OWNER, LEGACY_ID));
      expect(read?.scope).toBe('project');
    });

    it('cannot be created again, so the retired value cannot be spread', async () => {
      await expect(
        methods.createKnowledgeCollection(baseInput({ id: 'col-new', scope: 'project' }) as never),
      ).rejects.toThrow(/enumerated|enum/i);
      expect(await methods.getKnowledgeCollection(OWNER, 'col-new')).toBeNull();
    });
  });
});
