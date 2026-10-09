import type { Model, Types } from 'mongoose';
import type {
  IKnowledgeCollection,
  KnowledgeCollectionPatch,
  KnowledgeScope,
} from '~/types/knowledge';
import { createKnowledgeCollectionModel } from '~/models/knowledgeCollection';

type KnowledgeCollectionLean = IKnowledgeCollection & { _id: Types.ObjectId };

/** Signed change to the ingest-maintained counters. */
export interface KnowledgeCollectionStatsDelta {
  documentDelta: number;
  chunkDelta: number;
}

/**
 * How many collections a list returns when the caller names no limit.
 *
 * The cap was a bare `200` in the method's default parameter, which made it
 * invisible in both directions: nothing outside the method could read it, and
 * nothing reported that a page had stopped short, so a caller with more
 * collections than this received a full-looking list and a count that read as
 * complete. It is named and exported so the page size is one referenced number
 * instead of a magic default, and so {@link countKnowledgeCollections} can be
 * read as the thing that says whether the page is the whole list.
 *
 * Deliberately not a `rag:` config key: the retrieval defaults live in three
 * packages under a drift guard, and a list page size is not retrieval geometry
 * — nothing about chunking, scoring or the in-memory ceilings changes with it.
 */
export const KNOWLEDGE_COLLECTION_LIST_LIMIT = 200;

/** Owns a collection or the collection is `global` (readable by anyone). */
function visibleToUser(userId: string): Record<string, unknown> {
  return { $or: [{ userId }, { scope: 'global' }] };
}

/**
 * The only fields `updateKnowledgeCollection` will write, and the whole runtime
 * defence on that path.
 *
 * `KnowledgeCollectionPatch` already says this, but a TypeScript type is a
 * promise the compiler keeps, not the database: `findOneAndUpdate` is handed an
 * object, and whatever keys that object carries are `$set`. So a widened patch
 * type, an adapter that re-spread a whole document, or a cast at a call site
 * would have written `documentCount`, `chunkCount` or `scope: 'project'` and
 * nothing here would have complained. The create path has always defended
 * itself at runtime instead of trusting that promise — it hardcodes the counters
 * *after* spreading the input (`createKnowledgeCollection`, below), and
 * `knowledgeCollection.spec.ts` has a test for it. This is that same defence
 * for the update path.
 *
 * `scope` is the one mutable field whose *value* is constrained, and it is
 * deliberately not checked here: `runValidators` below asks the schema for
 * that, so the vocabulary lives in one place (`schema/knowledgeCollection.ts`)
 * rather than being restated in a second list that could drift from it.
 */
const MUTABLE_FIELDS = ['name', 'description', 'scope', 'updatedAt'] as const;

/**
 * The allowlisted half of a patch.
 *
 * Fields outside it are *dropped*, not refused: the create path's answer to a
 * caller-supplied counter is to keep its own, and dropping rather than throwing
 * means a stale or over-wide patch cannot turn an edit into a 500. The value of
 * a field that *is* on the list is never second-guessed here.
 */
function mutableFields(patch: KnowledgeCollectionPatch): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const field of MUTABLE_FIELDS) {
    if (patch[field] !== undefined) {
      set[field] = patch[field];
    }
  }
  return set;
}

/** Mongoose document -> plain object; the RAG domain never sees a Document. */
function toPlain(doc: KnowledgeCollectionLean): IKnowledgeCollection {
  return {
    id: doc.id,
    userId: doc.userId,
    name: doc.name,
    description: doc.description,
    scope: doc.scope as KnowledgeScope,
    chunkSize: doc.chunkSize,
    chunkOverlap: doc.chunkOverlap,
    documentCount: doc.documentCount,
    chunkCount: doc.chunkCount,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

export interface KnowledgeCollectionMethods {
  createKnowledgeCollection(input: {
    id: string;
    userId: string;
    name: string;
    description?: string;
    scope: KnowledgeScope;
    chunkSize: number;
    chunkOverlap: number;
  }): Promise<IKnowledgeCollection>;
  getKnowledgeCollection(
    userId: string,
    collectionId: string,
  ): Promise<IKnowledgeCollection | null>;
  /**
   * Owned collections plus `global` ones, newest first, capped at
   * {@link KNOWLEDGE_COLLECTION_LIST_LIMIT}.
   *
   * A full page is not evidence that the caller has nothing more, so this is
   * only ever half the answer: pair it with {@link countKnowledgeCollections}.
   */
  listKnowledgeCollections(userId: string, limit?: number): Promise<IKnowledgeCollection[]>;
  /**
   * How many collections the caller can see — owned plus `global`, under the
   * same filter and the same sort order as the list, but uncapped.
   *
   * This is the number that separates "the page is the whole list" from "the
   * page stopped at {@link KNOWLEDGE_COLLECTION_LIST_LIMIT}". It is a separate
   * call rather than a flag on the list because a capped page cannot tell the
   * difference on its own: a caller with exactly 200 collections and a caller
   * with 250 produce identical pages.
   */
  countKnowledgeCollections(userId: string): Promise<number>;
  /** Owner-only writes; non-owners get `null` regardless of the patch. */
  updateKnowledgeCollection(
    userId: string,
    collectionId: string,
    patch: KnowledgeCollectionPatch,
  ): Promise<IKnowledgeCollection | null>;
  /**
   * Apply a signed delta to the ingest counters with a single atomic `$inc`.
   * Reading the counts and writing them back would lose increments whenever two
   * ingests for one collection interleave, which is the normal case for a
   * populated knowledge base.
   */
  bumpKnowledgeCollectionStats(
    userId: string,
    collectionId: string,
    delta: KnowledgeCollectionStatsDelta,
  ): Promise<IKnowledgeCollection | null>;
  deleteKnowledgeCollection(userId: string, collectionId: string): Promise<boolean>;
}

export function createKnowledgeCollectionMethods(
  mongoose: typeof import('mongoose'),
): KnowledgeCollectionMethods {
  const model: Model<KnowledgeCollectionLean> = createKnowledgeCollectionModel(
    mongoose,
  ) as unknown as Model<KnowledgeCollectionLean>;

  return {
    async createKnowledgeCollection(input) {
      const now = new Date();
      const created = await model.create({
        ...input,
        documentCount: 0,
        chunkCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      return toPlain(created.toObject() as KnowledgeCollectionLean);
    },

    async getKnowledgeCollection(userId, collectionId) {
      const found = await model
        .findOne({ id: collectionId, ...visibleToUser(userId) })
        .lean()
        .exec();
      return found ? toPlain(found as KnowledgeCollectionLean) : null;
    },

    async listKnowledgeCollections(userId, limit = KNOWLEDGE_COLLECTION_LIST_LIMIT) {
      const found = await model
        .find(visibleToUser(userId))
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean()
        .exec();
      return (found as KnowledgeCollectionLean[]).map(toPlain);
    },

    async countKnowledgeCollections(userId) {
      /**
       * The same filter as the list, so the two cannot disagree about who a
       * collection belongs to — and `countDocuments` rather than a full scan,
       * because this runs on every list and only its result is wanted.
       */
      return model.countDocuments(visibleToUser(userId)).exec();
    },

    async updateKnowledgeCollection(userId, collectionId, patch) {
      const updated = await model
        .findOneAndUpdate(
          { id: collectionId, userId },
          { $set: mutableFields(patch) },
          /**
           * `runValidators` is the other half of the allowlist's runtime
           * defence, and it is what the write-time narrowing of `scope` rests
           * on: `create` validates because `model.create` always does, and
           * without this the schema's `enum` was consulted by nothing that
           * mutates. A stored row keeps whatever it was written with — the
           * enum constrains writes, it does not migrate them — and an update
           * validates the fields it writes, not the ones already stored, so a
           * row written before the narrowing can still be renamed or migrated.
           */
          { new: true, runValidators: true },
        )
        .lean()
        .exec();
      return updated ? toPlain(updated as KnowledgeCollectionLean) : null;
    },

    async bumpKnowledgeCollectionStats(userId, collectionId, delta) {
      const updated = await model
        .findOneAndUpdate(
          { id: collectionId, userId },
          {
            $inc: { documentCount: delta.documentDelta, chunkCount: delta.chunkDelta },
            $set: { updatedAt: new Date() },
          },
          { new: true },
        )
        .lean()
        .exec();
      return updated ? toPlain(updated as KnowledgeCollectionLean) : null;
    },

    async deleteKnowledgeCollection(userId, collectionId) {
      const result = await model.deleteOne({ id: collectionId, userId }).exec();
      return result.deletedCount > 0;
    },
  };
}
