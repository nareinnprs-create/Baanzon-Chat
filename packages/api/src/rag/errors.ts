/**
 * RAG domain errors.
 *
 * The HTTP layer classifies by the error's declared status rather than by
 * matching its message text, so renaming a message can never silently change an
 * API response. `RagError` messages are written for the caller and reach the
 * client; anything else is an internal fault and is logged, not returned.
 */
/**
 * Statuses a `RagError` may declare. `400`/`403`/`404` are the caller's
 * mistakes; `409` is a well-formed request that conflicts with the deployment's
 * current state (a configured capacity ceiling), which a caller can retry after
 * the operator drains or raises it. `500` is reserved: `mapThrown` already
 * answers a bare 500 for anything that is not a `RagError`, so a 500 member
 * here would exist only to disclose a `RagError` message on an internal fault —
 * the one thing this module exists to prevent. Nothing constructs it.
 */
export type RagErrorStatus = 400 | 403 | 404 | 409 | 500;

export class RagError extends Error {
  readonly status: RagErrorStatus;

  constructor(message: string, status: RagErrorStatus) {
    super(message);
    this.name = 'RagError';
    this.status = status;
  }
}

/** Bad input the caller can correct. */
export const badRequest = (message: string): RagError => new RagError(message, 400);

/** The caller is authenticated but not allowed to touch this resource. */
export const forbidden = (message = 'Forbidden'): RagError => new RagError(message, 403);

/** The resource does not exist, or the caller may not know that it does. */
export const notFound = (message = 'Not Found'): RagError => new RagError(message, 404);

/**
 * A configured store ceiling is exhausted, so the write was refused.
 *
 * 409, not 507: the request is well formed and would succeed unchanged once
 * the ceiling is raised, which is what `409 Conflict` describes (it conflicts
 * with the resource's current state), and it keeps the failure in the 4xx class
 * a client already backs off from. 507 Insufficient Storage is the closer
 * literal fit, but it is a 5xx: reporting an operator-configured limit as a
 * server fault sends it to server-error alerting and invites a page instead of
 * a retry, and nothing in the request can fix it. The message is written for
 * the caller and reaches the client, because "this deployment is full" is the
 * only thing the caller can act on and it discloses nothing the caller does not
 * already know about their own request.
 */
export const capacityExceeded = (message: string): RagError => new RagError(message, 409);
