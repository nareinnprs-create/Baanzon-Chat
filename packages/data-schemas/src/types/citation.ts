import type { Document, Types } from 'mongoose';

/**
 * A citation tying a source to a span of a message (blueprint §45 `citations`).
 *
 * A message can carry many citations and a source can be cited from many
 * messages, so the link is its own row rather than a field on either side.
 * `index` orders the citations within one message for stable rendering.
 */
export interface ICitation {
  _id?: Types.ObjectId;
  sourceId: Types.ObjectId;
  messageId: string;
  conversationId: string;
  /** The user whose message carries the citation. */
  user: Types.ObjectId;
  /** Zero-based position within the message. */
  index: number;
  /** The cited excerpt, when the answer quotes the source inline. */
  quote?: string;
  /** Retrieval relevance score, when one is available. */
  score?: number;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ICitationDocument extends Omit<ICitation, '_id'>, Document {}

export interface AddCitationInput {
  sourceId: string;
  messageId: string;
  conversationId: string;
  user: string;
  index: number;
  quote?: string;
  score?: number;
}
