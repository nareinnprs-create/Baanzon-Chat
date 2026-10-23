import type {
  CreateFeedbackInput,
  FeedbackStatus,
  FeedbackType,
  ListFeedbackOptions,
  UpdateFeedbackInput,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types';

/**
 * Storage-shaped feedback row. Kept Mongoose-free so `packages/api` never
 * carries `Types.ObjectId` / `Document` in an exported signature; the injected
 * data-schemas methods return values structurally compatible with this.
 */
export interface FeedbackRecord {
  _id?: unknown;
  userId?: unknown;
  email?: string;
  type: FeedbackType;
  subject: string;
  message: string;
  rating?: number;
  submittedAt?: Date | string;
  status?: FeedbackStatus;
  processedBy?: unknown;
  tenantId?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

/** Wire shape returned by the feedback API; ids are strings and dates are ISO-8601. */
export interface FeedbackDTO {
  id: string;
  userId?: string;
  email?: string;
  type: FeedbackType;
  subject: string;
  message: string;
  rating?: number;
  submittedAt?: string;
  status: FeedbackStatus;
  processedBy?: string;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** `POST /api/feedback` body. `userId` is never accepted from the body. */
export interface FeedbackCreateRequest {
  email?: string;
  type: FeedbackType;
  subject: string;
  message: string;
  rating?: number;
  submittedAt?: Date;
}

/** `PATCH /api/feedback/:id` body. Only triage fields are mutable. */
export interface FeedbackUpdateRequest {
  status?: FeedbackStatus;
  processedBy?: string;
}

/** `GET /api/feedback` query filters. The owner is always the authenticated user. */
export interface FeedbackListQuery {
  type?: FeedbackType;
  status?: FeedbackStatus;
}

/** The subset of `packages/data-schemas` feedback methods the handlers depend on. */
export interface FeedbackDataSource {
  createFeedback(input: CreateFeedbackInput): Promise<FeedbackRecord>;
  getFeedback(feedbackId: string): Promise<FeedbackRecord | null>;
  listFeedback(options?: ListFeedbackOptions): Promise<FeedbackRecord[]>;
  updateFeedback(feedbackId: string, patch: UpdateFeedbackInput): Promise<FeedbackRecord | null>;
  deleteFeedback(feedbackId: string): Promise<boolean>;
}

export interface FeedbackHandlers {
  list: (req: ServerRequest, res: Response) => Promise<Response>;
  get: (req: ServerRequest, res: Response) => Promise<Response>;
  create: (req: ServerRequest, res: Response) => Promise<Response>;
  update: (req: ServerRequest, res: Response) => Promise<Response>;
  delete: (req: ServerRequest, res: Response) => Promise<Response>;
}
