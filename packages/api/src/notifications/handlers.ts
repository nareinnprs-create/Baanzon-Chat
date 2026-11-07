import { z } from 'zod';
import { logger } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { NotificationsService } from './service';
import type { NotificationStreamHub } from './stream';
import type { ServerRequest } from '~/types/http';
import { resolveNotificationsSettings } from './config';

export interface NotificationsHandlersDeps {
  service: NotificationsService;
  hub: NotificationStreamHub;
}

export interface NotificationsHandlers {
  listNotifications: (req: ServerRequest, res: Response) => Promise<Response>;
  getUnreadCount: (req: ServerRequest, res: Response) => Promise<Response>;
  markRead: (req: ServerRequest, res: Response) => Promise<Response>;
  markAllRead: (req: ServerRequest, res: Response) => Promise<Response>;
  deleteNotification: (req: ServerRequest, res: Response) => Promise<Response>;
  createNotification: (req: ServerRequest, res: Response) => Promise<Response>;
  stream: (req: ServerRequest, res: Response) => Promise<Response | void>;
}

const createNotificationSchema = z.object({
  type: z.enum(['system', 'agent_run', 'mention', 'share', 'schedule', 'knowledge']),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(2000).optional(),
  link: z.string().trim().max(2048).optional(),
  data: z.record(z.unknown()).optional(),
});

function resolveUserId(req: ServerRequest): string | null {
  const user = req.user;
  if (!user) {
    return null;
  }
  const userId = user._id?.toString() ?? user.id;
  return userId || null;
}

function parsePositiveInt(raw: unknown): number | undefined {
  if (raw == null || raw === '') {
    return undefined;
  }
  const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function parseBoolean(raw: unknown): boolean | undefined {
  if (raw == null || raw === '') {
    return undefined;
  }
  if (typeof raw === 'boolean') {
    return raw;
  }
  return String(raw) === 'true';
}

export function createNotificationsHandlers(
  deps: NotificationsHandlersDeps,
): NotificationsHandlers {
  const { service, hub } = deps;

  async function listNotifications(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const settings = resolveNotificationsSettings(req.config?.config?.notifications);
      if (!settings.enabled) {
        return res.status(404).json({ error: 'Notifications are disabled' });
      }

      const query = req.query as Record<string, unknown>;
      const page = await service.list(userId, {
        limit: parsePositiveInt(query.limit),
        page: parsePositiveInt(query.page),
        unreadOnly: parseBoolean(query.unreadOnly),
      });
      return res.status(200).json({ ...page, settings });
    } catch (err) {
      logger.error('[notifications] list error:', err);
      return res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  }

  async function getUnreadCount(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const settings = resolveNotificationsSettings(req.config?.config?.notifications);
      if (!settings.enabled) {
        return res.status(404).json({ error: 'Notifications are disabled' });
      }
      const count = await service.unreadCount(userId);
      return res.status(200).json({ count, settings });
    } catch (err) {
      logger.error('[notifications] unread count error:', err);
      return res.status(500).json({ error: 'Failed to fetch unread count' });
    }
  }

  async function markRead(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const settings = resolveNotificationsSettings(req.config?.config?.notifications);
      if (!settings.enabled) {
        return res.status(404).json({ error: 'Notifications are disabled' });
      }
      const { id } = req.params as { id?: string };
      const notification = id ? await service.markRead(userId, id) : null;
      if (!notification) {
        return res.status(404).json({ error: 'Notification not found' });
      }
      return res.status(200).json({ notification });
    } catch (err) {
      logger.error('[notifications] mark read error:', err);
      return res.status(500).json({ error: 'Failed to update notification' });
    }
  }

  async function markAllRead(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const settings = resolveNotificationsSettings(req.config?.config?.notifications);
      if (!settings.enabled) {
        return res.status(404).json({ error: 'Notifications are disabled' });
      }
      const modified = await service.markAllRead(userId);
      return res.status(200).json({ modified });
    } catch (err) {
      logger.error('[notifications] mark all read error:', err);
      return res.status(500).json({ error: 'Failed to update notifications' });
    }
  }

  async function deleteNotification(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const settings = resolveNotificationsSettings(req.config?.config?.notifications);
      if (!settings.enabled) {
        return res.status(404).json({ error: 'Notifications are disabled' });
      }
      const { id } = req.params as { id?: string };
      const deleted = id ? await service.remove(userId, id) : false;
      if (!deleted) {
        return res.status(404).json({ error: 'Notification not found' });
      }
      return res.status(200).json({ deleted: true });
    } catch (err) {
      logger.error('[notifications] delete error:', err);
      return res.status(500).json({ error: 'Failed to delete notification' });
    }
  }

  async function createNotification(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const settings = resolveNotificationsSettings(req.config?.config?.notifications);
      if (!settings.enabled) {
        return res.status(404).json({ error: 'Notifications are disabled' });
      }
      const parsed = createNotificationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid notification payload' });
      }
      const notification = await service.create(userId, parsed.data);
      const unreadCount = await service.unreadCount(userId);
      hub.publish(userId, notification, unreadCount);
      return res.status(201).json({ notification });
    } catch (err) {
      logger.error('[notifications] create error:', err);
      return res.status(500).json({ error: 'Failed to create notification' });
    }
  }

  async function stream(req: ServerRequest, res: Response): Promise<Response | void> {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const settings = resolveNotificationsSettings(req.config?.config?.notifications);
    if (!settings.enabled || !settings.realtime) {
      return res.status(404).json({ error: 'Realtime notifications are disabled' });
    }
    try {
      const unreadCount = await service.unreadCount(userId);
      hub.subscribe(userId, res, { unreadCount });
      return undefined;
    } catch (err) {
      logger.error('[notifications] stream error:', err);
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Failed to open notification stream' });
      }
      res.end();
      return undefined;
    }
  }

  return {
    listNotifications,
    getUnreadCount,
    markRead,
    markAllRead,
    deleteNotification,
    createNotification,
    stream,
  };
}
