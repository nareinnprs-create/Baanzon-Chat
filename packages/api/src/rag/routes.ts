/**
 * RAG / Knowledge — Express-shaped request handlers (blueprint §24, §45).
 *
 * The domain's `RagHandlers` are DTO-in/DTO-out; this module is the only place
 * that maps a request into a domain call, so `/api` keeps requires, route
 * registration and nothing else. Express is imported for types only.
 */
import type { AppConfig } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { HandlerResult } from './handlers';
import type { RagRuntimeDeps } from './runtime';
import type { RagActor } from './authorization';
import type { CollectionScope } from './types';
import type { RagHandlers } from './handlers';
import {
  validateAddDocument,
  validateCollectionPatch,
  validateCreateCollection,
  validateRetrieve,
} from './validation';
import { createRagRuntimeResolver, resolveRagConfig } from './runtime';

interface RagBody {
  [key: string]: unknown;
  name?: string;
  description?: string;
  scope?: CollectionScope;
  chunkSize?: number;
  chunkOverlap?: number;
  content?: string;
  source?: string;
  query?: string;
  hybridAlpha?: number;
  topK?: number;
  metadata?: Record<string, unknown>;
}

type RagRequest = Request<Record<string, string>, object, RagBody, Record<string, string>> & {
  /**
   * The passport user document `requireJwtAuth` populates. `role` is the
   * `SystemRoles` value from that document, which is the only place the
   * Knowledge domain can learn whether the caller is an admin — the service
   * has no session to ask.
   */
  user?: { id?: string; role?: string };
  /** The real `AppConfig`, so a config key that stops being forwarded is a
   *  compile error here rather than a silently inert field. */
  config?: AppConfig;
};

const CREATED = 201;

/**
 * The only fields a patch may set, and the only ones forwarded below.
 *
 * Named because the refusal that follows it has to say what is allowed: a
 * message naming the offending field and the editable three answers the
 * question the caller actually has, where "invalid request" does not.
 */
const EDITABLE_FIELDS = ['name', 'description', 'scope'] as const;

/**
 * The collection's own fields, none of which a patch can move.
 *
 * `routes.ts` has always dropped everything outside the allowlist, and a drop is
 * the worst of the available answers: `PATCH { chunkSize: 0 }` answered 200 with
 * the field silently ignored, where the same field on `POST` is a 400 — so the
 * one thing a caller could not do (re-chunk a collection whose contents are
 * already stored at the old geometry) looked like the one thing it had done.
 * Answering 400 makes the two halves of the API agree: a field this API models
 * and will not change is refused, not acknowledged.
 *
 * These are the collection's *own* fields, listed from the same set
 * `createCollection` returns, so a value a caller could read and reason about
 * cannot be sent back and quietly discarded. A key outside both lists — a
 * `role`, a typo, a field from another API — is still ignored, so an unrecognised
 * extra never turns a rename into an error, and the admin-only gate on `global`
 * still answers a body carrying `role` with the 403 it is testing for.
 */
const IMMUTABLE_FIELDS = [
  'id',
  'userId',
  'chunkSize',
  'chunkOverlap',
  'documentCount',
  'chunkCount',
  'createdAt',
  'updatedAt',
] as const;

/**
 * Single exit point for every route. Failures are always a top-level
 * `{ error }` with the domain's status; `wrap` only shapes a success body, so
 * a client can parse errors identically across all eight routes. It is
 * required rather than defaulted so that adding a route forces a decision
 * about its success shape.
 *
 * Generic in the payload so `wrap` reads the handler's own return type instead
 * of `unknown`: this is the layer that decides what a route sends, and an
 * envelope written against `unknown` is a shape nothing checks — naming a
 * field that does not exist on the payload compiled here. The body is returned
 * as it is given, because one route (`createCollection`) answers with the
 * domain payload itself rather than wrapping it.
 */
function reply<T>(
  res: Response,
  result: HandlerResult<T>,
  wrap: (data: T) => unknown,
  created = false,
) {
  if (!result.ok) {
    return res.status(result.status).json({ error: result.message });
  }
  return res.status(created ? CREATED : 200).json(wrap(result.data));
}

export function createRagRoutes(deps: RagRuntimeDeps) {
  const resolveRuntime = createRagRuntimeResolver(deps);

  /** App config is per request; the runtime is cached against that object. */
  const runtimeFor = (req: RagRequest) => resolveRuntime(req.config?.rag);

  /**
   * The same resolved config the runtime above is built from, handed to the
   * validators so they judge a request against the deployment rather than
   * against `RAG_DEFAULTS`. `resolveRagConfig` is pure and cheap, and the
   * alternative — validating against defaults while the service stores the
   * configured size — is precisely the mismatch that let an overlap of 500
   * through against a configured chunk size of 200.
   */
  const ragConfigFor = (req: RagRequest) => resolveRagConfig(req.config?.rag);

  const call = (req: RagRequest): RagHandlers => runtimeFor(req).domainHandlers;

  const userId = (req: RagRequest): string => req.user?.id ?? '';

  /**
   * The authorization context the service cannot invent for itself. Built per
   * request and read only as far as the domain needs it, so the route supplies
   * the fact and the service owns the rule — `canUseScope` stays the single
   * place that decides, and a direct service call with no actor is refused
   * `global` rather than quietly granted it.
   */
  const actor = (req: RagRequest): RagActor => ({ role: req.user?.role });

  /** `rag.disabled` is a real kill switch, answered uniformly on every route. */
  const gate = async (req: RagRequest, res: Response): Promise<boolean> => {
    if (runtimeFor(req).disabled) {
      res.status(503).json({ error: 'Knowledge retrieval is disabled' });
      return false;
    }
    return true;
  };

  return {
    async createCollection(req: RagRequest, res: Response): Promise<Response | undefined> {
      if (!(await gate(req, res))) {
        return undefined;
      }
      const invalid = validateCreateCollection(req.body ?? {}, ragConfigFor(req));
      if (!invalid.ok) {
        return res.status(400).json({ error: invalid.error });
      }
      const { name, description, scope, chunkSize, chunkOverlap } = req.body ?? {};
      return reply(
        res,
        await call(req).createCollection(
          {
            userId: userId(req),
            name: name as string,
            description,
            scope,
            chunkSize,
            chunkOverlap,
          },
          actor(req),
        ),
        /** The collection itself, unwrapped: this route has always answered bare. */
        (data) => data,
        true,
      );
    },

    async listCollections(req: RagRequest, res: Response): Promise<Response | undefined> {
      if (!(await gate(req, res))) {
        return undefined;
      }
      return reply(
        res,
        await call(req).listCollections(userId(req)),
        /**
         * `collections` is the same array under the same key as it has always
         * been, so a client that reads nothing else is byte-for-byte
         * unaffected — that is what makes this additive rather than a
         * reshaping. The three fields beside it are the ones the list could not
         * state before:
         *
         * - `total` / `hasMore`: whether the page is everything the caller has
         *   or the first page of more, which is what separates "you have no
         *   collections" from "there are more than are shown" — a header count
         *   derived from `collections` alone cannot tell them apart, and
         *   neither can an empty-state rule, because the cap can only ever
         *   produce a *full* page, never an empty one.
         * - `capacity`: how much room the deployment's vector index has left
         *   before an ingest is refused with a 409, on the same route and the
         *   same `rag.disabled` gate.
         */
        (data) => ({
          collections: data.collections,
          total: data.total,
          hasMore: data.hasMore,
          capacity: data.capacity,
        }),
      );
    },

    async getCollection(req: RagRequest, res: Response): Promise<Response | undefined> {
      if (!(await gate(req, res))) {
        return undefined;
      }
      return reply(
        res,
        await call(req).getCollection(userId(req), req.params.collectionId ?? ''),
        (data) => ({ collection: data }),
      );
    },

    async updateCollection(req: RagRequest, res: Response): Promise<Response | undefined> {
      if (!(await gate(req, res))) {
        return undefined;
      }
      const body = req.body ?? {};
      /**
       * Refused here rather than dropped, and before the field validator, so a
       * request this API will not honour cannot borrow a 200 from a valid name
       * beside it. `{ error }` like every other failure on this route, and a 400
       * for the same reason `POST` gives one for the same field.
       */
      const refused = IMMUTABLE_FIELDS.filter((field) => body[field] !== undefined);
      if (refused.length > 0) {
        return res.status(400).json({
          error:
            `${refused.join(', ')} cannot be changed after a collection is created; ` +
            `a patch may only set ${EDITABLE_FIELDS.join(', ')}`,
        });
      }
      const invalid = validateCollectionPatch(body);
      if (!invalid.ok) {
        return res.status(400).json({ error: invalid.error });
      }
      const { name, description, scope } = body;
      return reply(
        res,
        await call(req).updateCollection(
          userId(req),
          req.params.collectionId ?? '',
          {
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(scope !== undefined ? { scope } : {}),
          },
          actor(req),
        ),
        (data) => ({ updated: true, collection: data }),
      );
    },

    async deleteCollection(req: RagRequest, res: Response): Promise<Response | undefined> {
      if (!(await gate(req, res))) {
        return undefined;
      }
      return reply(
        res,
        await call(req).deleteCollection(userId(req), req.params.collectionId ?? ''),
        (data) => ({ deleted: data }),
      );
    },

    async addDocument(req: RagRequest, res: Response): Promise<Response | undefined> {
      if (!(await gate(req, res))) {
        return undefined;
      }
      const collectionId = req.params.collectionId ?? '';
      const invalid = validateAddDocument(req.body ?? {}, collectionId);
      if (!invalid.ok) {
        return res.status(400).json({ error: invalid.error });
      }
      const { content, source, metadata } = req.body ?? {};
      return reply(
        res,
        await call(req).addDocument({
          userId: userId(req),
          collectionId,
          content: content as string,
          source,
          metadata,
        }),
        (data) => data,
        true,
      );
    },

    async deleteDocument(req: RagRequest, res: Response): Promise<Response | undefined> {
      if (!(await gate(req, res))) {
        return undefined;
      }
      return reply(
        res,
        await call(req).deleteDocument(
          userId(req),
          req.params.collectionId ?? '',
          req.params.documentId ?? '',
        ),
        (data) => ({ deleted: data }),
      );
    },

    async retrieve(req: RagRequest, res: Response): Promise<Response | undefined> {
      if (!(await gate(req, res))) {
        return undefined;
      }
      const collectionId = req.params.collectionId ?? '';
      const invalid = validateRetrieve(req.body ?? {}, collectionId);
      if (!invalid.ok) {
        return res.status(400).json({ error: invalid.error });
      }
      const { query, hybridAlpha, topK } = req.body ?? {};
      return reply(
        res,
        await call(req).retrieve({
          userId: userId(req),
          collectionId,
          query: query as string,
          hybridAlpha,
          topK,
        }),
        (data) => ({ snippets: data }),
      );
    },
  };
}

export type RagRoutes = ReturnType<typeof createRagRoutes>;
