import type { Model } from 'mongoose';
import type {
  IMessagePart,
  IMessagePartDocument,
  AddMessagePartInput,
  UpdateMessagePartInput,
} from '~/types/messagePart';
import { isValidObjectIdString } from '~/utils/objectId';

export interface MessagePartMethods {
  /** Adds or replaces the part at `index`; idempotent per (messageId, index). */
  addMessagePart(input: AddMessagePartInput): Promise<IMessagePart>;
  /** Ordered parts of one message, owned by `user`. */
  listMessageParts(user: string, messageId: string): Promise<IMessagePart[]>;
  /** Ordered parts of a whole conversation, owned by `user`. */
  listConversationParts(user: string, conversationId: string): Promise<IMessagePart[]>;
  updateMessagePart(
    user: string,
    partId: string,
    patch: UpdateMessagePartInput,
  ): Promise<IMessagePart | null>;
  deleteMessagePart(user: string, partId: string): Promise<boolean>;
  /** Bulk removal when a message is deleted; returns the number removed. */
  deleteMessagePartsForMessage(messageId: string): Promise<number>;
}

export function createMessagePartMethods(mongoose: typeof import('mongoose')): MessagePartMethods {
  const MessagePart = (): Model<IMessagePartDocument> =>
    mongoose.models.MessagePart as Model<IMessagePartDocument>;

  async function addMessagePart(input: AddMessagePartInput): Promise<IMessagePart> {
    const part = await MessagePart()
      .findOneAndUpdate(
        { messageId: input.messageId, index: input.index },
        {
          $set: {
            conversationId: input.conversationId,
            user: input.user,
            type: input.type,
            text: input.text,
            content: input.content,
          },
        },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      )
      .lean<IMessagePart>();
    if (!part) {
      throw new Error('Failed to add message part');
    }
    return part;
  }

  async function listMessageParts(user: string, messageId: string): Promise<IMessagePart[]> {
    return await MessagePart()
      .find({ user, messageId })
      .sort({ index: 1, _id: 1 })
      .lean<IMessagePart[]>();
  }

  async function listConversationParts(
    user: string,
    conversationId: string,
  ): Promise<IMessagePart[]> {
    return await MessagePart()
      .find({ user, conversationId })
      .sort({ messageId: 1, index: 1, _id: 1 })
      .lean<IMessagePart[]>();
  }

  async function updateMessagePart(
    user: string,
    partId: string,
    patch: UpdateMessagePartInput,
  ): Promise<IMessagePart | null> {
    if (!isValidObjectIdString(partId)) {
      return null;
    }

    const update: Partial<Pick<IMessagePart, 'text' | 'content'>> = {};
    if (patch.text !== undefined) {
      update.text = patch.text;
    }
    if (patch.content !== undefined) {
      update.content = patch.content;
    }

    return await MessagePart()
      .findOneAndUpdate({ _id: partId, user }, { $set: update }, { new: true, runValidators: true })
      .lean<IMessagePart>();
  }

  async function deleteMessagePart(user: string, partId: string): Promise<boolean> {
    if (!isValidObjectIdString(partId)) {
      return false;
    }
    const result = await MessagePart().deleteOne({ _id: partId, user });
    return result.deletedCount === 1;
  }

  async function deleteMessagePartsForMessage(messageId: string): Promise<number> {
    const result = await MessagePart().deleteMany({ messageId });
    return result.deletedCount ?? 0;
  }

  return {
    addMessagePart,
    listMessageParts,
    listConversationParts,
    updateMessagePart,
    deleteMessagePart,
    deleteMessagePartsForMessage,
  };
}
