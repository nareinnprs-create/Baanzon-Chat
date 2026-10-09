import { Schema } from 'mongoose';
import type { IKnowledgeCollectionDoc } from '~/types/knowledge';

export const KNOWLEDGE_COLLECTION_NAME = 'KnowledgeCollection';

const KnowledgeCollectionSchema: Schema<IKnowledgeCollectionDoc> = new Schema({
  id: {
    type: String,
    required: true,
  },
  userId: {
    type: String,
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: undefined,
  },
  scope: {
    type: String,
    /**
     * Matches `KnowledgeScope` (`~/types/knowledge`) and the two unions the RAG
     * domain and the client share. `project` was here, which is how a stored row
     * could still carry it: the schema permitted the value the type had already
     * given up.
     *
     * Narrowing this is a write-time constraint, not a migration. Reads never
     * consult it — every read is `.lean()` — and a row stored as `project`
     * before the refusal still reads back, owner-only, through
     * `visibleToUser`. Both mutating paths are now covered from the write side:
     * `create` refuses the value because `model.create` always validates, and
     * `updateKnowledgeCollection` passes `runValidators`, so a patch naming
     * `project` is refused here too rather than by the type. The one mutator
     * left without validators is `bumpKnowledgeCollectionStats`, which `$inc`s
     * the two counters and writes no scope at all. An update validates the
     * fields it *writes*, not the ones already stored, so a legacy row can
     * still be renamed and patched to `private`.
     */
    enum: ['private', 'global'],
    default: 'private',
  },
  chunkSize: {
    type: Number,
    required: true,
  },
  chunkOverlap: {
    type: Number,
    required: true,
  },
  documentCount: {
    type: Number,
    default: 0,
  },
  chunkCount: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    required: true,
  },
  updatedAt: {
    type: Date,
    required: true,
  },
  tenantId: {
    type: String,
    index: true,
  },
});

/** Collection ids are uuid, not ObjectId — uniqueness is global, not per user. */
KnowledgeCollectionSchema.index({ id: 1 }, { unique: true });
/** Listing is always per owner, newest first. */
KnowledgeCollectionSchema.index({ userId: 1, updatedAt: -1 });
/** Global collections are read by every authenticated user, so scope is a query term. */
KnowledgeCollectionSchema.index({ scope: 1, updatedAt: -1 });

export default KnowledgeCollectionSchema;
