import type { Document, Types } from 'mongoose';

/** The kind of report a piece of feedback represents. */
export type FeedbackType = 'bug' | 'feature' | 'improvement' | 'general';

/** Triage state for a feedback item. */
export type FeedbackStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

/**
 * User-submitted feedback (blueprint §45 `feedback`).
 *
 * May be anonymous (an email with no account) or tied to a user, and carries a
 * triage status a maintainer advances as the report is processed.
 */
export interface IFeedback {
  _id?: Types.ObjectId;
  userId?: Types.ObjectId;
  email?: string;
  type: FeedbackType;
  subject: string;
  message: string;
  rating?: number;
  submittedAt: Date;
  status?: FeedbackStatus;
  processedBy?: Types.ObjectId;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IFeedbackDocument extends Omit<IFeedback, '_id'>, Document {}

export interface CreateFeedbackInput {
  userId?: string;
  email?: string;
  type: FeedbackType;
  subject: string;
  message: string;
  rating?: number;
  submittedAt?: Date;
  status?: FeedbackStatus;
}

export interface UpdateFeedbackInput {
  status?: FeedbackStatus;
  processedBy?: string;
}

export interface ListFeedbackOptions {
  type?: FeedbackType;
  status?: FeedbackStatus;
  userId?: string;
}
