import { useEffect } from 'react';
import { getDefaultStore } from 'jotai';
import { QueryKeys, dataService } from 'librechat-data-provider';
import { useQuery } from '@tanstack/react-query';
import type { TTrustRequest, TTrustResponse } from 'librechat-data-provider';
import type { UseQueryOptions } from '@tanstack/react-query';
import { trustAtom } from './atoms';

/**
 * Scores one entity's evidence through the stateless trust engine
 * (`GET /api/trust/:entityType/:id`). Evidence travels on the query — there
 * is no persisted trust-evidence exchange yet (A7.1b), so callers hand the
 * engine what they have and it answers deterministically.
 */
export const useTrust = (
  params: TTrustRequest,
  config?: UseQueryOptions<TTrustResponse>,
): ReturnType<typeof useQuery<TTrustResponse>> => {
  const query = useQuery<TTrustResponse>(
    [QueryKeys.trust, params.entityType, params.id],
    () => dataService.getTrust(params),
    {
      // A verdict is a pure function of the passed evidence; re-fetching on
      // window focus would only recompute the same number.
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      enabled: Boolean(params.entityType && params.id),
      ...config,
    },
  );

  useEffect(() => {
    if (query.data && query.data.id === params.id) {
      getDefaultStore().set(trustAtom, query.data);
    }
  }, [query.data, params.id]);

  return query;
};
