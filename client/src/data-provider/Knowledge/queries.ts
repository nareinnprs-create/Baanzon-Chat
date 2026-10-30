import { useQuery } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';
import type {
  TKnowledgeCollectionListResponse,
  TKnowledgeCollectionResponse,
} from 'librechat-data-provider';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import { getResponseStatus } from '~/utils/errors';

/** `rag.disabled` is answered uniformly on every knowledge route (see `packages/api/src/rag/routes.ts`). */
const KNOWLEDGE_DISABLED_STATUS = 503;

/**
 * Whether an error is the `rag.disabled` kill switch, decided by HTTP status.
 *
 * The server answers `503 { error: 'Knowledge retrieval is disabled' }` on every
 * route when the switch is on, and `RagError` (the other 4xx/5xx paths) never
 * claims 503 — so the status alone is the discriminator and no message text is
 * matched. `getResponseStatus` unwraps it for both axios and non-axios errors, so
 * this holds however the request failed.
 */
export const isKnowledgeDisabledError = (error: unknown): boolean =>
  getResponseStatus(error) === KNOWLEDGE_DISABLED_STATUS;

/**
 * Availability reported by {@link useKnowledgeCollectionsEnabledQuery}.
 *
 * `disabled` is the only verdict here. An `available` boolean was carried
 * alongside it and nothing read it — `isSuccess` was already on the underlying
 * observer result — so it is gone rather than left as a second, quieter way to
 * ask the same question and drift from it.
 */
export type TKnowledgeAvailability = {
  /** `rag.disabled` is on — every knowledge route answers 503, so the UI hides itself. */
  disabled: boolean;
};

export type TKnowledgeAvailabilityQueryResult = QueryObserverResult<
  TKnowledgeCollectionListResponse,
  Error
> &
  TKnowledgeAvailability;

/**
 * The caller's collections.
 *
 * The list is a live server-authoritative resource, so the shared
 * `refetchOnWindowFocus` / `refetchOnReconnect` / `refetchOnMount: false` triple
 * applies: reconnect storms are the case these hooks exist to avoid.
 */
export const useKnowledgeCollectionsQuery = (
  config?: UseQueryOptions<TKnowledgeCollectionListResponse, Error>,
): QueryObserverResult<TKnowledgeCollectionListResponse, Error> => {
  return useQuery<TKnowledgeCollectionListResponse, Error>(
    [QueryKeys.knowledgeCollections],
    () => dataService.listKnowledgeCollections(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: (failureCount, error) => !isKnowledgeDisabledError(error) && failureCount < 3,
      ...config,
    },
  );
};

/**
 * A single collection, addressed by id. Disabled until an id is present, and not
 * re-enabled by a caller's own `enabled` — the id is what this hook needs.
 *
 * The data is the raw `{ collection }` envelope, matching `getKnowledgeCollection`.
 */
export const useKnowledgeCollectionQuery = (
  collectionId?: string | null,
  config?: UseQueryOptions<TKnowledgeCollectionResponse, Error>,
): QueryObserverResult<TKnowledgeCollectionResponse, Error> => {
  const enabled = Boolean(collectionId) && (config?.enabled ?? true);
  return useQuery<TKnowledgeCollectionResponse, Error>(
    [QueryKeys.knowledgeCollection, collectionId],
    () => dataService.getKnowledgeCollection(collectionId as string),
    {
      ...config,
      enabled,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
    },
  );
};

/**
 * Availability probe for the nav.
 *
 * It calls the same `listKnowledgeCollections` as the list query and adds two
 * booleans, so a caller branches on `disabled` instead of inspecting the error.
 * `disabled` is authoritative the moment the probe settles with a 503, which is
 * why `retry: false` is set — a kill switch will not clear itself, and a nav that
 * waits out retries shows a dead entry for seconds after it knows better.
 *
 * It keeps its own cache entry rather than sharing `[QueryKeys.knowledgeCollections]`
 * with the list: the two observers want different retry behaviour, and under a
 * shared key the first one mounted would decide retry for both.
 *
 * `rag.disabled` is an admin switch, so the answer goes stale the moment it is
 * flipped, and the client has no other way to learn about it — nothing in the
 * startup config or a permission carries it. A cached answer with no
 * revalidation would leave the nav entry hidden (or a disabled page interactive)
 * for as long as the cache entry lived, so the probe revalidates on every mount
 * and on every window focus. This is a cheap authenticated `GET` of the caller's
 * own collections, deduplicated per key by React Query: the shell and the
 * knowledge page both mount the probe under this same key, so they share one
 * in-flight request rather than doubling it. There is no `refetchInterval`, so
 * focus is the only revalidation trigger and there is no polling to storm.
 */
export const useKnowledgeCollectionsEnabledQuery = (): TKnowledgeAvailabilityQueryResult => {
  const query = useQuery<TKnowledgeCollectionListResponse, Error>(
    [QueryKeys.knowledgeCollections, 'availability'],
    () => dataService.listKnowledgeCollections(),
    {
      staleTime: 0,
      refetchOnWindowFocus: true,
      refetchOnReconnect: false,
      refetchOnMount: 'always',
      retry: false,
    },
  );

  return {
    ...query,
    disabled: isKnowledgeDisabledError(query.error),
  };
};
