import type { Model } from 'mongoose';
import type {
  ISource,
  ISourceDocument,
  CreateSourceInput,
} from '~/types/source';
import { isValidObjectIdString } from '~/utils/objectId';

/** Default page size for a source history. */
export const SOURCE_LIST_DEFAULT_LIMIT = 50;
/** Hard cap on a source history page. */
export const SOURCE_LIST_MAX_LIMIT = 200;

function normalizeLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    return SOURCE_LIST_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), SOURCE_LIST_MAX_LIMIT);
}

export interface SourceMethods {
  createSource(input: CreateSourceInput): Promise<ISource>;
  getSource(userId: string, sourceId: string): Promise<ISource | null>;
  /** A user's sources, newest first. */
  listSourcesForUser(userId: string, options?: { limit?: number }): Promise<ISource[]>;
  listSourcesForConversation(userId: string, conversationId: string): Promise<ISource[]>;
  deleteSource(userId: string, sourceId: string): Promise<boolean>;
}

export function createSourceMethods(mongoose: typeof import('mongoose')): SourceMethods {
  const Source = (): Model<ISourceDocument> => mongoose.models.Source as Model<ISourceDocument>;

  async function createSource(input: CreateSourceInput): Promise<ISource> {
    if (!isValidObjectIdString(input.user)) {
      throw new Error('A valid user is required');
    }
    const title = input.title?.trim();
    if (!title) {
      throw new Error('Source title is required');
    }

    const created = await Source().create({
      title,
      type: input.type,
      user: input.user,
      url: input.url,
      snippet: input.snippet,
      conversationId: input.conversationId,
      metadata: input.metadata,
    });
    return created.toObject() as ISource;
  }

  async function getSource(userId: string, sourceId: string): Promise<ISource | null> {
    if (!isValidObjectIdString(userId) || !isValidObjectIdString(sourceId)) {
      return null;
    }
    return await Source().findOne({ _id: sourceId, user: userId }).lean<ISource>();
  }

  async function listSourcesForUser(
    userId: string,
    options?: { limit?: number },
  ): Promise<ISource[]> {
    if (!isValidObjectIdString(userId)) {
      return [];
    }
    return await Source()
      .find({ user: userId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(normalizeLimit(options?.limit))
      .lean<ISource[]>();
  }

  async function listSourcesForConversation(
    userId: string,
    conversationId: string,
  ): Promise<ISource[]> {
    if (!isValidObjectIdString(userId) || !conversationId) {
      return [];
    }
    return await Source()
      .find({ user: userId, conversationId })
      .sort({ createdAt: 1, _id: 1 })
      .lean<ISource[]>();
  }

  async function deleteSource(userId: string, sourceId: string): Promise<boolean> {
    if (!isValidObjectIdString(userId) || !isValidObjectIdString(sourceId)) {
      return false;
    }
    const result = await Source().deleteOne({ _id: sourceId, user: userId });
    return result.deletedCount === 1;
  }

  return {
    createSource,
    getSource,
    listSourcesForUser,
    listSourcesForConversation,
    deleteSource,
  };
}
