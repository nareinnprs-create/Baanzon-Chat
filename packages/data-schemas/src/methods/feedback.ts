import type { Model } from 'mongoose';
import type {
  IFeedback,
  IFeedbackDocument,
  CreateFeedbackInput,
  UpdateFeedbackInput,
  ListFeedbackOptions,
} from '~/types/feedback';
import { isValidObjectIdString } from '~/utils/objectId';

export interface FeedbackMethods {
  createFeedback(input: CreateFeedbackInput): Promise<IFeedback>;
  getFeedback(feedbackId: string): Promise<IFeedback | null>;
  /** The triage queue, newest submission first. */
  listFeedback(options?: ListFeedbackOptions): Promise<IFeedback[]>;
  /** Moves a report through triage and records who handled it. */
  updateFeedback(feedbackId: string, patch: UpdateFeedbackInput): Promise<IFeedback | null>;
  deleteFeedback(feedbackId: string): Promise<boolean>;
}

export function createFeedbackMethods(mongoose: typeof import('mongoose')): FeedbackMethods {
  const Feedback = (): Model<IFeedbackDocument> =>
    mongoose.models.Feedback as Model<IFeedbackDocument>;

  async function createFeedback(input: CreateFeedbackInput): Promise<IFeedback> {
    if (input.userId && !isValidObjectIdString(input.userId)) {
      throw new Error('A valid userId is required');
    }

    const created = await Feedback().create({
      userId: input.userId,
      email: input.email,
      type: input.type,
      subject: input.subject,
      message: input.message,
      rating: input.rating,
      submittedAt: input.submittedAt ?? new Date(),
      status: input.status ?? 'open',
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    });
    return created.toObject() as IFeedback;
  }

  async function getFeedback(feedbackId: string): Promise<IFeedback | null> {
    if (!isValidObjectIdString(feedbackId)) {
      return null;
    }
    return await Feedback().findById(feedbackId).lean<IFeedback>();
  }

  async function listFeedback(options?: ListFeedbackOptions): Promise<IFeedback[]> {
    const filter: Record<string, unknown> = {};
    if (options?.type !== undefined) {
      filter.type = options.type;
    }
    if (options?.status !== undefined) {
      filter.status = options.status;
    }
    if (options?.userId) {
      if (!isValidObjectIdString(options.userId)) {
        return [];
      }
      filter.userId = options.userId;
    }
    if (options?.tenantId) {
      filter.tenantId = options.tenantId;
    }
    return await Feedback().find(filter).sort({ submittedAt: -1, _id: -1 }).lean<IFeedback[]>();
  }

  async function updateFeedback(
    feedbackId: string,
    patch: UpdateFeedbackInput,
  ): Promise<IFeedback | null> {
    if (!isValidObjectIdString(feedbackId)) {
      return null;
    }

    const update: Record<string, unknown> = {};
    if (patch.status !== undefined) {
      update.status = patch.status;
    }
    if (patch.processedBy !== undefined) {
      if (!isValidObjectIdString(patch.processedBy)) {
        throw new Error('A valid processedBy is required');
      }
      update.processedBy = patch.processedBy;
    }

    return await Feedback()
      .findByIdAndUpdate(feedbackId, { $set: update }, { new: true, runValidators: true })
      .lean<IFeedback>();
  }

  async function deleteFeedback(feedbackId: string): Promise<boolean> {
    if (!isValidObjectIdString(feedbackId)) {
      return false;
    }
    const deleted = await Feedback().findOneAndDelete({ _id: feedbackId });
    return !!deleted;
  }

  return { createFeedback, getFeedback, listFeedback, updateFeedback, deleteFeedback };
}
