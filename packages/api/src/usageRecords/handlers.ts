import { z } from 'zod';
import { isValidObjectIdString, logger } from '@librechat/data-schemas';
import type { CreateUsageRecordInput, UpdateUsageRecordInput } from '@librechat/data-schemas';
import type { Response } from 'express';
import type {
  UsageRecordDataSource,
  UsageRecordDTO,
  UsageRecordRow,
  UsageRecordsHandlers,
} from './types';
import type { ServerRequest } from '~/types';
import { resolveRequestTenantId } from '~/middleware/tenant';
import { queryString } from '~/utils/query';

const createUsageRecordSchema = z.object({
  scope: z.enum(['user', 'organization', 'workspace']).optional(),
  key: z.string().trim().min(1).max(200),
  value: z.number().min(0),
  unit: z.string().trim().min(1).max(50).optional(),
  recordedAt: z.coerce.date().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateUsageRecordSchema = z.object({
  value: z.number().min(0).optional(),
  unit: z.string().trim().min(1).max(50).optional(),
  metadata: z.record(z.unknown()).optional(),
});

interface Actor {
  userId: string;
  tenantId?: string;
}

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return 'Invalid usage record payload';
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

function serializeUsageRecord(record: UsageRecordRow): UsageRecordDTO {
  return {
    id: record._id == null ? '' : String(record._id),
    scope: record.scope,
    userId: record.userId == null ? undefined : String(record.userId),
    organizationId: record.organizationId == null ? undefined : String(record.organizationId),
    workspaceId: record.workspaceId == null ? undefined : String(record.workspaceId),
    key: record.key,
    value: record.value,
    unit: record.unit,
    recordedAt: toIso(record.recordedAt) ?? new Date(0).toISOString(),
    metadata: record.metadata,
    tenantId: record.tenantId,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

/** A record is visible only to its owner and only within the requester's tenant. */
function isVisible(record: UsageRecordRow, actor: Actor): boolean {
  const owner = record.userId == null ? '' : String(record.userId);
  if (owner !== actor.userId) {
    return false;
  }
  if (record.tenantId != null && actor.tenantId != null && record.tenantId !== actor.tenantId) {
    return false;
  }
  return true;
}

export function createUsageRecordsHandlers(deps: UsageRecordDataSource): UsageRecordsHandlers {
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
      res.status(400).json({ error: 'Invalid usage record id' });
      return null;
    }
    return id;
  }

  async function list(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const rawScope = queryString(req.query.scope);
    if (rawScope != null && rawScope !== 'user') {
      return res.status(400).json({ error: "scope must be 'user'" });
    }
    let from: Date | undefined;
    const rawFrom = queryString(req.query.from);
    if (rawFrom != null) {
      const parsed = z.coerce.date().safeParse(rawFrom);
      if (!parsed.success) {
        return res.status(400).json({ error: 'from must be a valid date' });
      }
      from = parsed.data;
    }
    let to: Date | undefined;
    const rawTo = queryString(req.query.to);
    if (rawTo != null) {
      const parsed = z.coerce.date().safeParse(rawTo);
      if (!parsed.success) {
        return res.status(400).json({ error: 'to must be a valid date' });
      }
      to = parsed.data;
    }
    try {
      const records = await deps.listUsageRecords({
        scope: 'user',
        userId: actor.userId,
        key: queryString(req.query.key),
        from,
        to,
      });
      return res.status(200).json({ usageRecords: records.map(serializeUsageRecord) });
    } catch (error) {
      logger.error('[usageRecords] Error listing usage records', error);
      return res.status(500).json({ error: 'Error listing usage records' });
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
      const record = await deps.getUsageRecord(id);
      if (!record || !isVisible(record, actor)) {
        return res.status(404).json({ error: 'Usage record not found' });
      }
      return res.status(200).json(serializeUsageRecord(record));
    } catch (error) {
      logger.error('[usageRecords] Error fetching usage record', error);
      return res.status(500).json({ error: 'Error fetching usage record' });
    }
  }

  async function create(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const parsed = createUsageRecordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: describeIssue(parsed.error) });
    }
    if (parsed.data.scope != null && parsed.data.scope !== 'user') {
      return res.status(400).json({ error: "scope must be 'user'" });
    }
    try {
      const input: CreateUsageRecordInput = {
        ...parsed.data,
        scope: 'user',
        userId: actor.userId,
      };
      const created = await deps.createUsageRecord(input);
      return res.status(201).json(serializeUsageRecord(created));
    } catch (error) {
      logger.error('[usageRecords] Error creating usage record', error);
      return res.status(500).json({ error: 'Error creating usage record' });
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
    const parsed = updateUsageRecordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: describeIssue(parsed.error) });
    }
    const patch: UpdateUsageRecordInput = parsed.data;
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'At least one field must be provided for update' });
    }
    try {
      const existing = await deps.getUsageRecord(id);
      if (!existing || !isVisible(existing, actor)) {
        return res.status(404).json({ error: 'Usage record not found' });
      }
      const updated = await deps.updateUsageRecord(id, patch);
      if (!updated) {
        return res.status(404).json({ error: 'Usage record not found' });
      }
      return res.status(200).json(serializeUsageRecord(updated));
    } catch (error) {
      logger.error('[usageRecords] Error updating usage record', error);
      return res.status(500).json({ error: 'Error updating usage record' });
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
      const existing = await deps.getUsageRecord(id);
      if (!existing || !isVisible(existing, actor)) {
        return res.status(404).json({ error: 'Usage record not found' });
      }
      const deleted = await deps.deleteUsageRecord(id);
      if (!deleted) {
        return res.status(404).json({ error: 'Usage record not found' });
      }
      return res.status(200).json({ deleted: true });
    } catch (error) {
      logger.error('[usageRecords] Error deleting usage record', error);
      return res.status(500).json({ error: 'Error deleting usage record' });
    }
  }

  return { list, get, create, update, delete: remove };
}
