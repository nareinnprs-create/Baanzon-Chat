import { useEffect } from 'react';
import { getDefaultStore } from 'jotai';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFeatureFlagsResponse, TSetFeatureFlagRequest } from 'librechat-data-provider';
import type { UseMutationResult, UseQueryOptions } from '@tanstack/react-query';
import { featureFlagsAtom } from './atoms';

export const useFeatureFlags = (
  organizationId?: string,
  config?: UseQueryOptions<TFeatureFlagsResponse>,
): ReturnType<typeof useQuery<TFeatureFlagsResponse>> => {
  const query = useQuery<TFeatureFlagsResponse>(
    [QueryKeys.flags, organizationId],
    () => dataService.getFlags(organizationId),
    {
      // Flags gate launches, so a stale-but-present map beats a blank one.
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      ...config,
    },
  );

  useEffect(() => {
    if (query.data?.flags) {
      getDefaultStore().set(featureFlagsAtom, query.data.flags);
    }
  }, [query.data]);

  return query;
};

export const useSetFeatureFlagMutation = (): UseMutationResult<
  Awaited<ReturnType<typeof dataService.setFeatureFlag>>,
  unknown,
  { key: string; payload: TSetFeatureFlagRequest },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(({ key, payload }) => dataService.setFeatureFlag(key, payload), {
    onSuccess: () => {
      void queryClient.invalidateQueries([QueryKeys.flags]);
    },
  });
};
