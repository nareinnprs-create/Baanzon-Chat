import { useEffect } from 'react';
import { getDefaultStore } from 'jotai';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TEvalRun, TEvalRunListParams, TEvalRunListResponse } from 'librechat-data-provider';
import type { UseMutationResult, UseQueryOptions } from '@tanstack/react-query';
import { evalRunsAtom } from './atoms';

export const useEvalRuns = (
  params?: TEvalRunListParams,
  config?: UseQueryOptions<TEvalRunListResponse>,
): ReturnType<typeof useQuery<TEvalRunListResponse>> => {
  const query = useQuery<TEvalRunListResponse>(
    [QueryKeys.evalRuns, params ?? null],
    () => dataService.listEvalRuns(params),
    {
      // Runs are finished history, so a stale-but-present list beats a blank one.
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      ...config,
    },
  );

  useEffect(() => {
    if (query.data?.runs) {
      getDefaultStore().set(evalRunsAtom, query.data.runs);
    }
  }, [query.data]);

  return query;
};

export const useEvalRun = (
  runId: string,
  config?: UseQueryOptions<TEvalRun>,
): ReturnType<typeof useQuery<TEvalRun>> => {
  return useQuery<TEvalRun>([QueryKeys.evalRuns, runId], () => dataService.getEvalRun(runId), {
    enabled: Boolean(runId),
    refetchOnWindowFocus: false,
    ...config,
  });
};

export const useCreateEvalRunMutation = (): UseMutationResult<
  Awaited<ReturnType<typeof dataService.createEvalRun>>,
  unknown,
  Parameters<typeof dataService.createEvalRun>[0],
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation((payload) => dataService.createEvalRun(payload), {
    onSuccess: () => {
      void queryClient.invalidateQueries([QueryKeys.evalRuns]);
    },
  });
};
