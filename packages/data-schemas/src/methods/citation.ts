import type { Model } from 'mongoose';
import type { ICitation, ICitationDocument, AddCitationInput } from '~/types/citation';
import { isValidObjectIdString } from '~/utils/objectId';

export interface CitationMethods {
  /** Adds or replaces the citation at `index`; idempotent per (messageId, index). */
  addCitation(input: AddCitationInput): Promise<ICitation>;
  /** Ordered citations of one message, owned by `user`. */
  listCitationsForMessage(userId: string, messageId: string): Promise<ICitation[]>;
  /** Ordered citations of a whole conversation, owned by `user`. */
  listCitationsForConversation(userId: string, conversationId: string): Promise<ICitation[]>;
  /** Bulk removal when a message is deleted; returns the number removed. */
  deleteCitationsForMessage(messageId: string): Promise<number>;
  deleteCitation(userId: string, citationId: string): Promise<boolean>;
}

export function createCitationMethods(mongoose: typeof import('mongoose')): CitationMethods {
  const Citation = (): Model<ICitationDocument> =>
    mongoose.models.Citation as Model<ICitationDocument>;

  async function addCitation(input: AddCitationInput): Promise<ICitation> {
    const citation = await Citation()
      .findOneAndUpdate(
        { messageId: input.messageId, index: input.index },
        {
          $set: {
            sourceId: input.sourceId,
            conversationId: input.conversationId,
            user: input.user,
            quote: input.quote,
            score: input.score,
          },
        },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      )
      .lean<ICitation>();
    if (!citation) {
      throw new Error('Failed to add citation');
    }
    return citation;
  }

  async function listCitationsForMessage(userId: string, messageId: string): Promise<ICitation[]> {
    if (!isValidObjectIdString(userId)) {
      return [];
    }
    return await Citation()
      .find({ user: userId, messageId })
      .sort({ index: 1, _id: 1 })
      .lean<ICitation[]>();
  }

  async function listCitationsForConversation(
    userId: string,
    conversationId: string,
  ): Promise<ICitation[]> {
    if (!isValidObjectIdString(userId)) {
      return [];
    }
    return await Citation()
      .find({ user: userId, conversationId })
      .sort({ messageId: 1, index: 1, _id: 1 })
      .lean<ICitation[]>();
  }

  async function deleteCitationsForMessage(messageId: string): Promise<number> {
    const result = await Citation().deleteMany({ messageId });
    return result.deletedCount ?? 0;
  }

  async function deleteCitation(userId: string, citationId: string): Promise<boolean> {
    if (!isValidObjectIdString(userId) || !isValidObjectIdString(citationId)) {
      return false;
    }
    const result = await Citation().deleteOne({ _id: citationId, user: userId });
    return result.deletedCount === 1;
  }

  return {
    addCitation,
    listCitationsForMessage,
    listCitationsForConversation,
    deleteCitationsForMessage,
    deleteCitation,
  };
}
