import { Schema } from 'mongoose';
import type { IChatProjectDocument } from '~/types';

const chatProjectSchema: Schema<IChatProjectDocument> = new Schema<IChatProjectDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      index: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 1000,
    },
    user: {
      type: String,
      required: true,
      index: true,
    },
    /**
     * Owning workspace (blueprint §57 middle rung of the
     * org -> workspace -> project hierarchy), stored as the workspace ObjectId
     * hex string the way `workspace.organizationId` is passed around.
     *
     * Optional: projects created before workspaces existed carry no value, and
     * a personal project outside any workspace never gets one.
     */
    workspaceId: {
      type: String,
      default: undefined,
    },
    conversationCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastConversationAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastConversationId: {
      type: String,
      default: null,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

chatProjectSchema.index({ user: 1, name: 1, _id: 1 });
chatProjectSchema.index({ user: 1, createdAt: -1, _id: -1 });
chatProjectSchema.index({ user: 1, lastConversationAt: -1, _id: -1 });
/**
 * Workspace-scoped list: every project read is user-scoped (and tenant-scoped by
 * the isolation plugin), so this mirrors the default `{ user, lastConversationAt,
 * _id }` list index with `workspaceId` as its prefix instead of adding a
 * standalone `workspaceId` index no query can use — a query on `workspaceId`
 * alone is never issued, because authorization always narrows to a member.
 *
 * Partial so pre-workspace projects (the field is optional and no backfill runs)
 * never enter the index: they can never match a `workspaceId` equality anyway.
 */
chatProjectSchema.index(
  { workspaceId: 1, user: 1, lastConversationAt: -1, _id: -1 },
  {
    name: 'workspaceId_1_user_1_lastConversationAt_-1__id_-1',
    partialFilterExpression: { workspaceId: { $exists: true } },
  },
);

export default chatProjectSchema;
