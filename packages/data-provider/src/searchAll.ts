import { z } from 'zod';

/**
 * Hard protocol cap for `GET /api/search/all` result count. The palette needs a
 * bounded result set per keystroke and the cap composes with the per-user rate
 * limiter, so matching `limit` against this constant keeps client, server and
 * limiter budget on one number.
 */
export const CROSS_ENTITY_SEARCH_MAX_LIMIT = 20;

/** Per-entity default when no `?limit` is sent. */
export const CROSS_ENTITY_SEARCH_DEFAULT_LIMIT = 10;

/** The longest `q` wire value; longer queries answer 400 instead of being clamped. */
export const CROSS_ENTITY_SEARCH_MAX_QUERY_LENGTH = 120;

export type TSearchAllRecordType = 'conversation' | 'project';

/**
 * One cross-entity search hit: enough for the palette to list, label, sort and
 * navigate. `href` is client navigation (`/c/:conversationId`, `/projects/:id`),
 * `updatedAt` feeds result ordering — all plain JSON, no storage types.
 */
export type TSearchAllRecord = {
  type: TSearchAllRecordType;
  id: string;
  title?: string;
  updatedAt: string | null;
  href: string;
};

/** `GET /api/search/all` response. */
export type TSearchAllResponse = {
  results: TSearchAllRecord[];
};

/**
 * `crossEntitySearch` levers (baanzon.yaml): `limit` is the per-request result
 * budget when the client sends no `?limit`. The hard cap above clamps it either
 * way; default reproduces the shipped behavior.
 */
export const crossEntitySearchConfigSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(CROSS_ENTITY_SEARCH_MAX_LIMIT)
      .optional()
      .default(CROSS_ENTITY_SEARCH_DEFAULT_LIMIT),
  })
  .strict();

export type CrossEntitySearchConfig = z.infer<typeof crossEntitySearchConfigSchema>;
