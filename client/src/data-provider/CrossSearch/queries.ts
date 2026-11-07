import { dataService, QueryKeys } from 'librechat-data-provider';
import type { TSearchAllResponse } from 'librechat-data-provider';
import { useQuery } from '@tanstack/react-query';
import type { UseQueryOptions } from '@tanstack/react-query';

/** The palette starts searching at two characters; matching server-side discs. */
export const CROSS_SEARCH_MIN_QUERY_LENGTH = 2;

/**
 * Cross-entity palette search (`GET /api/search/all`). Enabled once the query
 * reaches two characters and holds results for one second — palette keystrokes
 * are bursty, so a short staleTime lets back-to-back keys share the last
 * response without ever presenting minutes-old results.
 */
export const useCrossEntitySearch = (
  q: string,
  options?: {
    limit?: number;
    config?: UseQueryOptions<TSearchAllResponse>;
  },
): ReturnType<typeof useQuery<TSearchAllResponse>> => {
  const { limit, config } = options ?? {};
  const trimmed = q.trim();
  return useQuery<TSearchAllResponse>(
    [QueryKeys.searchAll, trimmed, limit ?? null],
    () => dataService.searchAll({ q: trimmed, limit }),
    {
      enabled: trimmed.length >= CROSS_SEARCH_MIN_QUERY_LENGTH,
      staleTime: 1000,
      refetchOnWindowFocus: false,
      ...config,
    },
  );
};
