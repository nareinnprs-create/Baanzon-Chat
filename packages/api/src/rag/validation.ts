/**
 * RAG / Knowledge domain — request validation.
 * Lightweight manual validators (no dependency) returning error strings.
 */
import { RAG_DEFAULTS } from './config';

const NAME_MAX = 64;
const DESC_MAX = 512;
const CONTENT_MAX = 400_000;
const QUERY_MAX = 2_000;
const CHUNK_SIZE_MIN = 16;
const CHUNK_SIZE_MAX = 8_000;
/**
 * `project` is absent deliberately, and not because it is unimplemented: it was
 * accepted here and stored, and visibility (`canAccessCollection`) is
 * owner-or-`global`, so a `project` collection came back exactly like a private
 * one — a control that silently did nothing. Accepting a scope that no
 * visibility rule honours would let an API client mint phantom project
 * collections regardless of what the UI offers.
 */
const SCOPES = ['private', 'global'];

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * The deployment's resolved `rag` config, or the part of it a check needs.
 *
 * Passed in rather than read from a module singleton because the validator's
 * verdict has to match the number the *service* is about to store, and that
 * number comes from whatever the deployment configured. `routes.ts` already
 * has the resolved config (`resolveRagConfig`, the same call that builds the
 * runtime), so the seam is the argument rather than a new import of app
 * state — the RAG domain keeps taking its config from its caller.
 */
export interface ValidationConfig {
  /**
   * `rag.chunkSize` after resolution, i.e. `baanzon.yaml` → `RAG_DEFAULTS`.
   * Optional so a caller with nothing resolved still gets the default verdict
   * instead of a second, disagreeing set of constants in this file.
   */
  chunkSize?: number;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Code points, not UTF-16 code units. Every cap here that reads as "characters"
 * to a caller is a limit on how much a person wrote, and `String.length` counts
 * a surrogate pair as two, so text made of emoji or other non-BMP characters got
 * half the documented budget — 32 emoji where 64 were promised, 33 refused.
 * Applying the cap to `name`, `description` and `query` alike is the point: the
 * first two are fields of the same document, and a cap that halves for some
 * strings and not others is a cap nobody can predict.
 *
 * Every BMP character is one code point, so this changes no ASCII verdict while
 * keeping the cap honest for the rest, and code points are never fewer than code
 * units, so it cannot let a longer string through. `content` is the exception and
 * says so at the check.
 */
function characterLength(value: string): number {
  return [...value].length;
}

function isValidScope(value: unknown): boolean {
  return typeof value === 'string' && SCOPES.includes(value);
}

/**
 * Chunk geometry is persisted with the collection, so an unvalidated value
 * detonates on a later ingest rather than on the request that set it: a
 * `chunkSize` of 0 is stored happily (`required` rejects only `undefined`) and
 * then fails every `POST /:id/documents` for that collection.
 */
function validateChunkGeometry(
  chunkSize: unknown,
  chunkOverlap: unknown,
  configuredChunkSize?: number,
): ValidationResult {
  if (chunkSize !== undefined) {
    if (typeof chunkSize !== 'number' || !Number.isInteger(chunkSize)) {
      return { ok: false, error: 'chunkSize must be an integer' };
    }
    if (chunkSize < CHUNK_SIZE_MIN || chunkSize > CHUNK_SIZE_MAX) {
      return {
        ok: false,
        error: `chunkSize must be between ${CHUNK_SIZE_MIN} and ${CHUNK_SIZE_MAX}`,
      };
    }
  }
  if (chunkOverlap !== undefined) {
    if (typeof chunkOverlap !== 'number' || !Number.isInteger(chunkOverlap)) {
      return { ok: false, error: 'chunkOverlap must be an integer' };
    }
    if (chunkOverlap < 0) {
      return { ok: false, error: 'chunkOverlap must be >= 0' };
    }
    /** The size the collection is *stored* with, which is the size the overlap
     *  has to be small enough for. Comparing only against a `chunkSize` the
     *  body happened to carry let an overlap of 1,000,000 through against a
     *  default 800 — and the chunker then caps the overlap at half the size, so
     *  the stored geometry and the effective geometry produce identical chunks.
     *  The caller's number would be silently discarded rather than refused.
     *
     *  Rejected rather than clamped, unlike `hybridAlpha`: that is a ranking
     *  weight with no invalid value, while an overlap at or above the size is an
     *  incoherent geometry the caller can correct. Clamping would also make the
     *  stored value differ from the requested one without saying so, which is
     *  the exact failure this validator exists to prevent.
     *
     *  The fallback order is request → resolved config → `RAG_DEFAULTS`, and it
     *  has to be that order. `RAG_DEFAULTS` alone is only the size a deployment
     *  gets when it configured nothing: `resolveRagConfig` prefers
     *  `rag.chunkSize`, and so does the service that stores the collection
     *  (`params.chunkSize ?? deps.config.chunkSize`). A deployment with
     *  `rag: { chunkSize: 200 }` and a body that omits `chunkSize` therefore
     *  used to be checked against 800 while 200 was about to be stored, so an
     *  overlap of 500 passed this gate and reached `chunkText` as 500 against
     *  200 — the degenerate geometry the check exists to prevent. The gate has
     *  to compare against the number the service will use, which is why the
     *  resolved config is an argument. */
    const effectiveChunkSize =
      typeof chunkSize === 'number' ? chunkSize : (configuredChunkSize ?? RAG_DEFAULTS.chunkSize);
    if (chunkOverlap >= effectiveChunkSize) {
      return { ok: false, error: 'chunkOverlap must be less than chunkSize' };
    }
  }
  return { ok: true };
}

/**
 * @param config the request's resolved `rag` config, so an omitted
 *               `chunkSize` is checked against the size the service will
 *               store rather than against the deployment default. Omitting it
 *               falls back to `RAG_DEFAULTS`, which is correct only for a
 *               deployment that configured nothing.
 */
export function validateCreateCollection(
  body: Record<string, unknown>,
  config?: ValidationConfig,
): ValidationResult {
  const name = clean(body.name);
  if (name.length === 0) {
    return { ok: false, error: 'name is required' };
  }
  if (characterLength(name) > NAME_MAX) {
    return { ok: false, error: `name must be <= ${NAME_MAX} characters` };
  }
  if (body.description !== undefined) {
    const d = clean(body.description);
    if (characterLength(d) > DESC_MAX) {
      return { ok: false, error: `description must be <= ${DESC_MAX} characters` };
    }
  }
  if (body.scope !== undefined && !isValidScope(body.scope)) {
    return { ok: false, error: `scope must be one of: ${SCOPES.join(', ')}` };
  }
  return validateChunkGeometry(body.chunkSize, body.chunkOverlap, config?.chunkSize);
}

/**
 * `collectionId` comes from the route path, not the body: accepting a second
 * source would let `POST /a/documents` ingest into `b` while every log and cache
 * built on the URL said `a`.
 */
export function validateAddDocument(
  body: Record<string, unknown>,
  collectionId: string,
): ValidationResult {
  if (clean(collectionId).length === 0) {
    return { ok: false, error: 'collectionId is required' };
  }
  const content = clean(body.content);
  if (!content) {
    return { ok: false, error: 'content is required' };
  }
  if (content.length > CONTENT_MAX) {
    // Deliberately still code units, unlike the name/description/query caps
    // above. Those are budgets on how much a person *wrote*, and halving them
    // for non-BMP text gives emoji half the advertised room. This one is a guard
    // on the size of a request body, and counting code points would raise the
    // worst case to roughly twice the bytes for the same cap — a different
    // trade, and not one to make as a side effect of a consistency fix.
    return { ok: false, error: `content must be <= ${CONTENT_MAX} characters` };
  }
  return { ok: true };
}

export function validateRetrieve(
  body: Record<string, unknown>,
  collectionId: string,
): ValidationResult {
  if (clean(collectionId).length === 0) {
    return { ok: false, error: 'collectionId is required' };
  }
  const query = clean(body.query);
  if (!query) {
    return { ok: false, error: 'query is required' };
  }
  if (characterLength(query) > QUERY_MAX) {
    return { ok: false, error: `query must be <= ${QUERY_MAX} characters` };
  }
  return { ok: true };
}

export function validateCollectionPatch(body: Record<string, unknown>): ValidationResult {
  const name = body.name !== undefined ? clean(body.name) : null;
  if (name !== null && (name.length === 0 || characterLength(name) > NAME_MAX)) {
    return { ok: false, error: `name must be 1..${NAME_MAX} characters` };
  }
  if (body.description !== undefined && characterLength(clean(body.description)) > DESC_MAX) {
    return { ok: false, error: `description must be <= ${DESC_MAX} characters` };
  }
  if (body.scope !== undefined && !isValidScope(body.scope)) {
    return { ok: false, error: `scope must be one of: ${SCOPES.join(', ')}` };
  }
  return { ok: true };
}
