import type { Document, Types } from 'mongoose';

/** The kind of content a single message part carries. */
export type MessagePartType = 'text' | 'reasoning' | 'tool_call' | 'tool_result' | 'image' | 'file';

/**
 * One ordered part of a message (blueprint §45 `message_parts`).
 *
 * Messages can carry more than a single text blob — an assistant turn may mix
 * reasoning, tool calls and their results, attachments and text. Splitting them
 * out lets each part be stored, replaced and rendered independently while the
 * message row stays small.
 */
export interface IMessagePart {
  _id?: Types.ObjectId;
  messageId: string;
  conversationId: string;
  /** Owning user id, in its string form (not an ObjectId ref). */
  user: string;
  /** Zero-based position within the message. */
  index: number;
  type: MessagePartType;
  text?: string;
  /** Type-specific payload; opaque to this package. */
  content?: Record<string, unknown>;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IMessagePartDocument extends Omit<IMessagePart, '_id'>, Document {}

export interface AddMessagePartInput {
  messageId: string;
  conversationId: string;
  user: string;
  index: number;
  type: MessagePartType;
  text?: string;
  content?: Record<string, unknown>;
}

export interface UpdateMessagePartInput {
  text?: string;
  content?: Record<string, unknown>;
}
