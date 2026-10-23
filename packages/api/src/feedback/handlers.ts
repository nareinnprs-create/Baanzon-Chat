import { z } from 'zod';
import { isValidObjectIdString, logger } from '@librechat/data-schemas';
import type { CreateFeedbackInput, UpdateFeedbackInput } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { FeedbackDataSource, FeedbackDTO, FeedbackHandlers, FeedbackRecord } from './types';
import type { ServerRequest } from '~/types';
import { resolveRequestTenantId } from '~/middleware/tenant';
import { queryString } from '~/utils/query';

const TYPES = ['bug', 'feature', 'improvement', 'general'] as const;
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

const createFeedbackSchema = z.object({
  email: z.string().trim().email().max(200).optional(),
  type: z.enum(['bug', 'feature', 'improvement', 'general']),
  subject: z.string().trim().min(1).max(300),
  message: z.string().trim().min(1).max(4000),
  rating: z.number().int().min(0).max(5).optional(),
  submittedAt: z.coerce.date().optional(),
});

const updateFeedbackSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  processedBy: z.string().trim().min(1).optional(),
});

interface Actor {
  userId: string;
  tenantId?: string;
}

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return 'Invalid feedback payload';
  }
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

function toIso(value?: Date | string): string | undefined {
  if (value == null) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function serializeFeedback(record: FeedbackRecord): FeedbackDTO {
  return {
    id: record._id == null ? '' : String(record._id),
    userId: record.userId == null ? undefined : String(record.userId),
    email: record.email,
    type: record.type,
    subject: record.subject,
    message: record.message,
    rating: record.rating,
    submittedAt: toIso(record.submittedAt),
    status: record.status ?? 'open',
    processedBy: record.processedBy == null ? undefined : String(record.processedBy),
    tenantId: record.tenantId,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

/** A record is visible only to its owner and only within the requester's tenant. */
function isVisible(record: FeedbackRecord, actor: Actor): boolean {
  const owner = record.userId == null ? '' : String(record.userId);
  if (owner !== actor.userId) {
    return false;
  }
  if (record.tenantId != null && actor.tenantId != null && record.tenantId !== actor.tenantId) {
    return false;
  }
  return true;
}

export function createFeedbackHandlers(deps: FeedbackDataSource): FeedbackHandlers {
  function resolveActor(req: ServerRequest, res: Response): Actor | null {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return null;
    }
    return { userId, tenantId: resolveRequestTenantId(req) };
  }

  function resolveId(req: ServerRequest, res: Response): string | null {
    const { id } = req.params as { id?: string };
    if (!id || !isValidObjectIdString(id)) {
      res.status(400).json({ error: 'Invalid feedback id' });
      return null;
    }
    return id;
  }

  async function list(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const rawType = queryString(req.query.type);
    let type: (typeof TYPES)[number] | undefined;
    if (rawType != null) {
      if (!isOneOf(TYPES, rawType)) {
        return res.status(400).json({ error: 'type is invalid' });
      }
      type = rawType;
    }
    const rawStatus = queryString(req.query.status);
    let status: (typeof STATUSES)[number] | undefined;
    if (rawStatus != null) {
      if (!isOneOf(STATUSES, rawStatus)) {
        return res.status(400).json({ error: 'status is invalid' });
      }
      status = rawStatus;
    }
    try {
      const feedback = await deps.listFeedback({ userId: actor.userId, type, status });
      return res.status(200).json({ feedback: feedback.map(serializeFeedback) });
    } catch (error) {
      logger.error('[feedback] Error listing feedback', error);
      return res.status(500).json({ error: 'Error listing feedback' });
    }
  }

  async function get(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const id = resolveId(req, res);
    if (!id) {
      return res;
    }
    try {
      const feedback = await deps.getFeedback(id);
      if (!feedback || !isVisible(feedback, actor)) {
        return res.status(404).json({ error: 'Feedback not found' });
      }
      return res.status(200).json(serializeFeedback(feedback));
    } catch (error) {
      logger.error('[feedback] Error fetching feedback', error);
      return res.status(500).json({ error: 'Error fetching feedback' });
    }
  }

  async function create(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const parsed = createFeedbackSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: describeIssue(parsed.error) });
    }
    try {
      const input: CreateFeedbackInput = { ...parsed.data, userId: actor.userId };
      const created = await deps.createFeedback(input);
      return res.status(201).json(serializeFeedback(created));
    } catch (error) {
      logger.error('[feedback] Error creating feedback', error);
      return res.status(500).json({ error: 'Error creating feedback' });
    }
  }

  async function update(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const id = resolveId(req, res);
    if (!id) {
      return res;
    }
    const parsed = updateFeedbackSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: describeIssue(parsed.error) });
    }
    const patch: UpdateFeedbackInput = parsed.data;
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'At least one field must be provided for update' });
    }
    if (patch.processedBy != null && !isValidObjectIdString(patch.processedBy)) {
      return res.status(400).json({ error: 'processedBy must be a valid id' });
    }
    try {
      const existing = await deps.getFeedback(id);
      if (!existing || !isVisible(existing, actor)) {
        return res.status(404).json({ error: 'Feedback not found' });
      }
      const updated = await deps.updateFeedback(id, patch);
      if (!updated) {
        return res.status(404).json({ error: 'Feedback not found' });
      }
      return res.status(200).json(serializeFeedback(updated));
    } catch (error) {
      logger.error('[feedback] Error updating feedback', error);
      return res.status(500).json({ error: 'Error updating feedback' });
    }
  }

  async function remove(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const id = resolveId(req, res);
    if (!id) {
      return res;
    }
    try {
      const existing = await deps.getFeedback(id);
      if (!existing || !isVisible(existing, actor)) {
        return res.status(404).json({ error: 'Feedback not found' });
      }
      const deleted = await deps.deleteFeedback(id);
      if (!deleted) {
        return res.status(404).json({ error: 'Feedback not found' });
      }
      return res.status(200).json({ deleted: true });
    } catch (error) {
      logger.error('[feedback] Error deleting feedback', error);
      return res.status(500).json({ error: 'Error deleting feedback' });
    }
  }

  return { list, get, create, update, delete: remove };
}
