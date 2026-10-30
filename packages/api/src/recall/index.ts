import { logger } from '@librechat/data-schemas';

/**
 * Cross-chat recall (X8): lexical Meilisearch over the `convos` and `messages`
 * indexes the mongoMeili plugin already maintains. v1 is intentionally lexical —
 * the upgrade path to semantic recall is a second vector index queried behind
 * this same `RecallSearchFn` interface, so the route contract does not change.
 */

export const RECALL_MAX_QUERY_LENGTH = 512;
export const RECALL_DEFAULT_LIMIT = 5;
/** Safety cap on snippets that arrive uncropped (e.g. missing `_formatted`). */
export const RECALL_SNIPPET_MAX_LENGTH = 300;
/** Crop attributes so Meili returns short `_formatted` snippets. */
export const RECALL_CROP_LENGTH = 40;
/** Message hits dedupe down to one per conversation; over-fetch so `limit` distinct conversations survive. */
export const RECALL_MESSAGE_FETCH_LIMIT = 15;

export interface RecallHit {
  conversationId: string;
  title: string;
  snippet: string;
  updatedAt: string | null;
}

export interface RecallResponse {
  hits: RecallHit[];
}

export interface RecallHttpResponse {
  status: number;
  body: RecallResponse | { message: string };
}

/** Structural slice of the Meilisearch search response the route needs. */
export type RecallSearchParams = {
  filter?: string;
  limit?: number;
  attributesToRetrieve?: string[];
  attributesToCrop?: string[];
  cropLength?: number;
};

/** The caller (route wiring) owns the Meili SDK client and passes this in. */
export type RecallSearchFn = (
  index: 'convos' | 'messages',
  q: string,
  params: RecallSearchParams,
) => Promise<{ hits: Array<Record<string, unknown>> }>;

export type RecallConvoMeta = { title?: unknown; updatedAt?: unknown };

/** Batched, user-scoped conversation metadata lookup (mongo side of hydration). */
export type RecallGetConvoMap = (
  userId: string,
  conversationIds: string[],
) => Promise<Record<string, RecallConvoMeta>>;

export type ValidateRecallQueryResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Validates and normalizes the `q` query parameter. Pure — exercised by spec.
 */
export function validateRecallQuery(q: unknown): ValidateRecallQueryResult {
  if (typeof q !== 'string' || q.trim().length === 0) {
    return { ok: false, error: 'q is required' };
  }
  const value = q.trim();
  if (value.length > RECALL_MAX_QUERY_LENGTH) {
    return { ok: false, error: `q must be at most ${RECALL_MAX_QUERY_LENGTH} characters` };
  }
  return { ok: true, value };
}

/**
 * Builds the Meili filter expression that scopes every hit to one user.
 * Escapes the two characters Meili's filter grammar treats specially.
 * Pure — exercised by spec.
 */
export function buildRecallUserFilter(userId: string): string {
  return `user = "${userId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const snippetCandidates = (hit: Record<string, unknown>): Array<unknown> => {
  const formatted = hit._formatted;
  if (formatted != null && typeof formatted === 'object') {
    const f = formatted as Record<string, unknown>;
    return [f.text, f.title, hit.title, hit.text];
  }
  return [hit.title, hit.text];
};

/**
 * Picks the best snippet for a hit: Meili's cropped `_formatted.text` (message
 * body around the match), falling back to the cropped/formatted or raw title,
 * then the raw text. Pure — exercised by spec.
 */
export function pickRecallSnippet(hit: Record<string, unknown>): string {
  for (const candidate of snippetCandidates(hit)) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.length > RECALL_SNIPPET_MAX_LENGTH
        ? `${candidate.slice(0, RECALL_SNIPPET_MAX_LENGTH)}…`
        : candidate;
    }
  }
  return '';
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const asUpdatedAt = (value: unknown): string | null => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === 'string' ? value : null;
};

type MergedHit = { conversationId: string; title: string; snippet: string; isConvoHit: boolean };

/**
 * Folds title hits and message hits into a deduped list capped at `limit`,
 * title hits first (they carry the conversation's own title). Hits without a
 * string `conversationId` are dropped. Pure — exercised by spec.
 */
export function mergeRecallHits(
  convoHits: Array<Record<string, unknown>>,
  messageHits: Array<Record<string, unknown>>,
  limit: number,
): MergedHit[] {
  const merged: MergedHit[] = [];
  const seen = new Set<string>();
  const push = (hit: Record<string, unknown>, isConvoHit: boolean): void => {
    const conversationId = asString(hit.conversationId);
    if (conversationId.length === 0 || seen.has(conversationId) || merged.length >= limit) {
      return;
    }
    seen.add(conversationId);
    merged.push({
      conversationId,
      title: asString(hit.title) || 'Untitled',
      snippet: pickRecallSnippet(hit),
      isConvoHit,
    });
  };
  for (const hit of convoHits) {
    push(hit, true);
  }
  for (const hit of messageHits) {
    push(hit, false);
  }
  return merged;
}

/**
 * Handles a GET /api/recall request end to end and never throws: the return
 * value carries the HTTP status. Only the query length and result count are
 * logged — never user text.
 */
export async function runRecall(params: {
  query: unknown;
  userId: string | undefined;
  search: RecallSearchFn | null;
  getConvoMap: RecallGetConvoMap;
  limit?: number;
}): Promise<RecallHttpResponse> {
  if (params.userId == null) {
    return { status: 401, body: { message: 'Authentication required' } };
  }
  const validation = validateRecallQuery(params.query);
  if (!validation.ok) {
    return { status: 400, body: { message: validation.error } };
  }
  if (params.search == null) {
    return { status: 503, body: { message: 'Recall search is not available' } };
  }
  const limit = params.limit ?? RECALL_DEFAULT_LIMIT;
  const filter = buildRecallUserFilter(params.userId);
  const q = validation.value;

  const [convoResult, messageResult] = await Promise.allSettled([
    params.search('convos', q, {
      filter,
      limit,
      attributesToRetrieve: ['conversationId', 'title'],
      attributesToCrop: ['title'],
      cropLength: RECALL_CROP_LENGTH,
    }),
    params.search('messages', q, {
      filter,
      limit: RECALL_MESSAGE_FETCH_LIMIT,
      attributesToRetrieve: ['conversationId', 'text'],
      attributesToCrop: ['text'],
      cropLength: RECALL_CROP_LENGTH,
    }),
  ]);

  if (convoResult.status === 'rejected' && messageResult.status === 'rejected') {
    logger.error('[recall] Both Meili searches failed', convoResult.reason);
    return { status: 502, body: { message: 'Recall search failed' } };
  }
  if (messageResult.status === 'rejected') {
    logger.warn('[recall] Message search failed, returning title matches only', messageResult.reason);
  }

  const convoHits =
    convoResult.status === 'fulfilled' ? (convoResult.value.hits ?? []) : [];
  const messageHits =
    messageResult.status === 'fulfilled' ? (messageResult.value.hits ?? []) : [];
  const merged = mergeRecallHits(convoHits, messageHits, limit);
  if (merged.length === 0) {
    return { status: 200, body: { hits: [] } };
  }

  let convoMap: Record<string, RecallConvoMeta> = {};
  try {
    convoMap = await params.getConvoMap(
      params.userId,
      merged.map((hit) => hit.conversationId),
    );
  } catch (error) {
    logger.warn('[recall] Conversation metadata lookup failed, using index fields only', error);
  }

  const hits: RecallHit[] = merged.map((hit) => {
    const meta = convoMap[hit.conversationId];
    return {
      conversationId: hit.conversationId,
      title: meta?.title != null && typeof meta.title === 'string' && meta.title.length > 0
        ? meta.title
        : hit.title,
      snippet: hit.snippet,
      updatedAt: asUpdatedAt(meta?.updatedAt),
    };
  });

  logger.info(`[recall] q=${q.length} chars, ${hits.length} hits for user`);
  return { status: 200, body: { hits } };
}
