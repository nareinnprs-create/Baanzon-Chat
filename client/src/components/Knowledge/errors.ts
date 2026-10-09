import type { LocalizeFunction } from '~/common';
import { getResponseStatus, isNotFoundError } from '~/utils/errors';
import { isKnowledgeDisabledError } from '~/data-provider';

/** Every knowledge route answers a failure with `{ error }` in the body
 *  (`packages/api/src/rag/routes.ts`), which axios surfaces as
 *  `error.response.data.error`. */
type KnowledgeErrorBody = { error?: unknown };

/** The status `RagError.capacityExceeded` declares (`packages/api/src/rag/errors.ts`):
 *  a well-formed request that conflicts with the deployment's current state. */
const KNOWLEDGE_CAPACITY_STATUS = 409;

function getServerErrorMessage(error: unknown): string | undefined {
  const body = (error as { response?: { data?: KnowledgeErrorBody } } | null)?.response?.data;
  return typeof body?.error === 'string' && body.error ? body.error : undefined;
}

/**
 * The message to show for a failed knowledge request.
 *
 * A `rag.disabled` 503 is a server-state answer and gets its own copy. A 4xx
 * carries a message the server wrote for the user — `name must be 1..64
 * characters`, `content must be <= 400000 characters` — which says what to fix in
 * a way no generic sentence can, and it is the difference between the user
 * learning their document was too long and the user guessing. Everything else (a
 * 500, a network drop, an unrecognised error shape) falls back to the generic
 * copy, so raw internals never reach the UI.
 *
 * The 4xx rule is "what the caller can fix", and that is why 409 is carved out
 * even though it is a 4xx. A 409 is the server's own use of the status for
 * *operator* state: `InMemoryVectorStore` refuses an ingest once the
 * deployment-wide chunk index is full (`inMemoryMaxChunks`, 20 000 by default),
 * and a create once `inMemoryMaxCollections` is full. Its message names the
 * config key that has to change, which is instructions for whoever administers
 * the deployment and nothing the user can act on — and it is easy to reach: the
 * server accepts a 400 000-character document, so roughly 35 of them exhaust
 * the index and every ingest after that fails the same way. Shown verbatim it
 * reads as a server fault and invites a support ticket about a document nobody
 * broke, so it gets the copy that names the actual next step.
 *
 * 404 is carved out for the mirror-image reason. The server answers it with the
 * bare word "Not Found", which says nothing about which of the collection, the
 * document or the request went missing — and a stale tab is the ordinary way to
 * get one, since a collection deleted next door is visible here until the next
 * refetch. The deletes do not reach here at all: `resolveDelete` in
 * `~/data-provider/Knowledge/mutations` turns their 404 into the success shape
 * first, so this is the copy for a write that *failed* because its collection
 * is gone, and it names the cause instead of restating the status.
 *
 * Centralised because every caller repeated the same 503-or-generic ternary, and
 * each repetition was another place the server's own 400 could be dropped and
 * leave the user guessing.
 */
export function getKnowledgeErrorMessage(error: unknown, localize: LocalizeFunction): string {
  if (isKnowledgeDisabledError(error)) {
    return localize('com_ui_knowledge_error_disabled');
  }
  const status = getResponseStatus(error);
  const serverMessage = getServerErrorMessage(error);
  if (status === KNOWLEDGE_CAPACITY_STATUS) {
    return localize('com_ui_knowledge_error_capacity');
  }
  if (isNotFoundError(error)) {
    return localize('com_ui_knowledge_error_not_found');
  }
  if (status != null && status < 500 && serverMessage != null) {
    return serverMessage;
  }
  return localize('com_ui_knowledge_error_generic');
}
