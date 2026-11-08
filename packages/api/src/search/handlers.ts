import { logger } from '@librechat/data-schemas';
import {
  CROSS_ENTITY_SEARCH_DEFAULT_LIMIT,
  CROSS_ENTITY_SEARCH_MAX_LIMIT,
  CROSS_ENTITY_SEARCH_MAX_QUERY_LENGTH,
  crossEntitySearchConfigSchema,
  type TSearchAllRecord,
  type TSearchAllResponse,
} from 'librechat-data-provider';
import type { Response } from 'express';
import type { SearchHandlers, SearchHandlersDeps, SearchRecord } from './types';
import type { ServerRequest } from '~/types/http';

const AUTH_REQUIRED = 'Authentication required';
const QUERY_TOO_LONG = 'Search query too long';
const SEARCH_FAILED = 'Error searching';

/**
 * Cross-entity search handlers for the Command Palette. The injected store does
 * the work (both entities are user-scoped at the data-schemas layer), inputs
 * are validated before the store is touched, and every lever is bounded.
 *
 * Scoping edge: `requireJwtAuth` on the route makes `req.user` the only scope —
 * both store methods narrow to that user's own rows via their existing user
 * index; a workspace member's peers' chats/projects are deliberately not in the
 * palette (cross-member geography lives in the workspace and project browsers).
 */
export function createSearchHandlers(deps: SearchHandlersDeps): SearchHandlers {
  const { store } = deps;

  async function searchAll(req: ServerRequest, res: Response): Promise<Response> {
    const user = req.user?._id?.toString() ?? req.user?.id;
    if (!user) {
      /** Defense in depth for direct reuse; the route carries requireJwtAuth. */
      return res.status(401).json({ error: AUTH_REQUIRED });
    }

    /** Per-deploy default budget when the client sends no `?limit` lever. */
    let defaultLimit = CROSS_ENTITY_SEARCH_DEFAULT_LIMIT;
    const rawLever = req.config?.config?.crossEntitySearch;
    if (rawLever != null) {
      const parsed = crossEntitySearchConfigSchema.safeParse(rawLever);
      if (parsed.success) {
        defaultLimit = parsed.data.limit;
      }
    }

    const rawQuery = typeof req.query.q === 'string' ? req.query.q : '';
    const query = rawQuery.trim();
    if (!query) {
      return res.status(200).json({ results: [] });
    }
    if (query.length > CROSS_ENTITY_SEARCH_MAX_QUERY_LENGTH) {
      return res.status(400).json({ error: QUERY_TOO_LONG });
    }

    let limit = defaultLimit;
    const rawLimit = parseInt(String(req.query.limit ?? ''), 10);
    if (Number.isFinite(rawLimit) && rawLimit > 0) {
      limit = Math.min(rawLimit, CROSS_ENTITY_SEARCH_MAX_LIMIT);
    }

    try {
      /**
       * One promise per entity, each capped at `limit`; the merged list is
       * freshly-activity-first, so the palette shows the most recently touched
       * hits without either entity starving the other.
       */
      const [conversations, projects] = await Promise.all([
        store.searchConversationsByTitle(user, query, limit),
        store.searchChatProjectsByTitle(user, query, limit),
      ]);
      const rows: SearchRecord[] = [
        ...conversations.map<TSearchAllRecord>((hit) => ({
          type: 'conversation',
          id: hit.conversationId,
          title: hit.title,
          updatedAt: hit.updatedAt ? new Date(hit.updatedAt).toISOString() : null,
          href: `/c/${hit.conversationId}`,
        })),
        ...projects.map<TSearchAllRecord>((hit) => ({
          type: 'project',
          id: hit.id,
          title: hit.name,
          updatedAt: hit.lastConversationAt ? new Date(hit.lastConversationAt).toISOString() : null,
          href: `/projects/${hit.id}`,
        })),
      ];
      const results = rows.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
      const response: TSearchAllResponse = { results };
      return res.status(200).json(response);
    } catch (error) {
      logger.error('[searchAll] Error searching', error);
      return res.status(500).json({ error: SEARCH_FAILED });
    }
  }

  return { searchAll };
}
