/**
 * Client mirrors of `packages/api/src/rag/validation.ts`.
 *
 * The server rejects a request that exceeds these, and the client has to reach
 * the same numbers without importing `packages/api` (a server package) into the
 * browser bundle. They are duplicated on purpose rather than shared through
 * `librechat-data-provider`: the validators are a server route contract, not a
 * transport type, and a change to one without the other is caught by the
 * `maxLength` tests in `client/src/components/Knowledge/__tests__` plus the
 * server's own validation suite.
 */
export const KNOWLEDGE_NAME_MAX_LENGTH = 64;
export const KNOWLEDGE_DESCRIPTION_MAX_LENGTH = 512;
/** `content` for `POST /:collectionId/documents`. */
export const KNOWLEDGE_CONTENT_MAX_LENGTH = 400_000;
/** `query` for `POST /:collectionId/retrieve`. */
export const KNOWLEDGE_QUERY_MAX_LENGTH = 2_000;

/**
 * Characters, not UTF-16 code units.
 *
 * The server's `characterLength` (`packages/api/src/rag/validation.ts`) counts
 * code points for `name`, `description` and `query`, because each cap is a limit
 * on characters and a surrogate pair is one character. `content` is the
 * exception and is measured with `.length` there — it guards a request body
 * rather than a field someone wrote, and code points would double the worst-case
 * byte size for the same cap — so `maxLength` is its exact match.
 */
export const countCodePoints = (value: string): number => [...value].length;

/** Whether `name` is over what the server accepts, measured the way it measures. */
export const isKnowledgeNameTooLong = (value: string): boolean =>
  countCodePoints(value) > KNOWLEDGE_NAME_MAX_LENGTH;

/** Whether `description` is over what the server accepts. */
export const isKnowledgeDescriptionTooLong = (value: string): boolean =>
  countCodePoints(value) > KNOWLEDGE_DESCRIPTION_MAX_LENGTH;

/** Whether `query` is over what the server accepts. */
export const isKnowledgeQueryTooLong = (value: string): boolean =>
  countCodePoints(value) > KNOWLEDGE_QUERY_MAX_LENGTH;

/**
 * The `maxLength` for each field the server measures in code points.
 *
 * HTML counts UTF-16 code units, so `maxLength={64}` would stop a name at 32
 * emoji — a name the server accepts, refused by the client. Twice the code-point
 * cap is the widest a valid value can be in code units, so this is a hard ceiling
 * that never rejects a value the server would take, and the `is…TooLong` helpers
 * are what gate the submit against the real rule.
 */
export const KNOWLEDGE_NAME_MAX_UNITS = KNOWLEDGE_NAME_MAX_LENGTH * 2;
export const KNOWLEDGE_DESCRIPTION_MAX_UNITS = KNOWLEDGE_DESCRIPTION_MAX_LENGTH * 2;
export const KNOWLEDGE_QUERY_MAX_UNITS = KNOWLEDGE_QUERY_MAX_LENGTH * 2;
