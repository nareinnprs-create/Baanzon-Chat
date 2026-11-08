import { z } from 'zod';
import { isValidObjectIdString, logger } from '@librechat/data-schemas';
import type { CreateDeviceInput, UpdateDeviceInput } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { DeviceDataSource, DeviceDTO, DeviceRecord, DevicesHandlers } from './types';
import type { ServerRequest } from '~/types';
import { resolveRequestTenantId } from '~/middleware/tenant';
import { queryString } from '~/utils/query';

const createDeviceSchema = z.object({
  deviceId: z.string().trim().min(1).optional(),
  deviceName: z.string().trim().min(1).max(200).optional(),
  platform: z.enum(['windows', 'macos', 'linux', 'android', 'ios', 'web', 'other']).optional(),
  os: z.string().trim().min(1).max(100).optional(),
  browser: z.string().trim().min(1).max(100).optional(),
  appVersion: z.string().trim().min(1).max(50).optional(),
  ipAddress: z.string().trim().min(1).max(64).optional(),
  userAgent: z.string().trim().min(1).max(1000).optional(),
  lastSeenAt: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
});

const updateDeviceSchema = createDeviceSchema.omit({ deviceId: true });

interface Actor {
  userId: string;
  tenantId?: string;
}

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return 'Invalid device payload';
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

function serializeDevice(record: DeviceRecord): DeviceDTO {
  return {
    id: record._id == null ? '' : String(record._id),
    userId: record.userId == null ? '' : String(record.userId),
    deviceId: record.deviceId,
    deviceName: record.deviceName,
    platform: record.platform,
    os: record.os,
    browser: record.browser,
    appVersion: record.appVersion,
    ipAddress: record.ipAddress,
    userAgent: record.userAgent,
    lastSeenAt: toIso(record.lastSeenAt),
    isActive: record.isActive ?? true,
    tenantId: record.tenantId,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

/** A record is visible only to its owner and only within the requester's tenant. */
function isVisible(record: DeviceRecord, actor: Actor): boolean {
  const owner = record.userId == null ? '' : String(record.userId);
  if (owner !== actor.userId) {
    return false;
  }
  if (record.tenantId != null && actor.tenantId != null && record.tenantId !== actor.tenantId) {
    return false;
  }
  return true;
}

export function createDevicesHandlers(deps: DeviceDataSource): DevicesHandlers {
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
      res.status(400).json({ error: 'Invalid device id' });
      return null;
    }
    return id;
  }

  async function list(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const rawActive = queryString(req.query.active);
    if (rawActive != null && rawActive !== 'true' && rawActive !== 'false') {
      return res.status(400).json({ error: 'active must be true or false' });
    }
    try {
      const devices = await deps.listDevices({
        userId: actor.userId,
        isActive: rawActive == null ? undefined : rawActive === 'true',
      });
      return res.status(200).json({ devices: devices.map(serializeDevice) });
    } catch (error) {
      logger.error('[devices] Error listing devices', error);
      return res.status(500).json({ error: 'Error listing devices' });
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
      const device = await deps.getDevice(id);
      if (!device || !isVisible(device, actor)) {
        return res.status(404).json({ error: 'Device not found' });
      }
      return res.status(200).json(serializeDevice(device));
    } catch (error) {
      logger.error('[devices] Error fetching device', error);
      return res.status(500).json({ error: 'Error fetching device' });
    }
  }

  async function create(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req, res);
    if (!actor) {
      return res;
    }
    const parsed = createDeviceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: describeIssue(parsed.error) });
    }
    try {
      const input: CreateDeviceInput = { ...parsed.data, userId: actor.userId };
      const created = await deps.createDevice(input);
      return res.status(201).json(serializeDevice(created));
    } catch (error) {
      logger.error('[devices] Error creating device', error);
      return res.status(500).json({ error: 'Error creating device' });
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
    const parsed = updateDeviceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: describeIssue(parsed.error) });
    }
    const patch: UpdateDeviceInput = parsed.data;
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'At least one field must be provided for update' });
    }
    try {
      const existing = await deps.getDevice(id);
      if (!existing || !isVisible(existing, actor)) {
        return res.status(404).json({ error: 'Device not found' });
      }
      const updated = await deps.updateDevice(id, patch);
      if (!updated) {
        return res.status(404).json({ error: 'Device not found' });
      }
      return res.status(200).json(serializeDevice(updated));
    } catch (error) {
      logger.error('[devices] Error updating device', error);
      return res.status(500).json({ error: 'Error updating device' });
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
      const existing = await deps.getDevice(id);
      if (!existing || !isVisible(existing, actor)) {
        return res.status(404).json({ error: 'Device not found' });
      }
      const deleted = await deps.deleteDevice(id);
      if (!deleted) {
        return res.status(404).json({ error: 'Device not found' });
      }
      return res.status(200).json({ deleted: true });
    } catch (error) {
      logger.error('[devices] Error deleting device', error);
      return res.status(500).json({ error: 'Error deleting device' });
    }
  }

  return { list, get, create, update, delete: remove };
}
