import type { Response } from 'express';
import type { TSearchAllRecord } from 'librechat-data-provider';
import type { ServerRequest } from '~/types/http';

/** The wire record for one search hit (`packages/api` keeps it alias-identical). */
export type SearchRecord = TSearchAllRecord;

/**
 * Storage-shaped conversation hit; `packages/api` never carries Mongoose types
 * in its exported signatures (see the workspace-boundary policy in AGENTS.md).
 */
export interface SearchConversationRow {
  conversationId: string;
  title: string;
  updatedAt?: Date | null;
}

/** Storage-shaped project hit, mirroring `ChatProjectTitleHit`. */
export interface SearchProjectRow {
  id: string;
  name: string;
  lastConversationAt?: Date | null;
}

/** The data-schemas title-search methods the handlers depend on (DI-injected). */
export interface SearchStore {
  searchConversationsByTitle(
    user: string,
    query: string,
    limit?: number,
  ): Promise<SearchConversationRow[]>;
  searchChatProjectsByTitle(
    user: string,
    query: string,
    limit?: number,
  ): Promise<SearchProjectRow[]>;
}

export interface SearchHandlersDeps {
  store: SearchStore;
}

export interface SearchHandlers {
  /** `GET /api/search/all?q=&limit=`: bounded cross-entity hits for the palette. */
  searchAll: (req: ServerRequest, res: Response) => Promise<Response>;
}
