import { useEffect } from 'react';
import { getDefaultStore } from 'jotai';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  TEntitlementPlan,
  TEntitlementResource,
  TGetEntitlementsResponse,
  TSetEntitlementRequest,
} from 'librechat-data-provider';
import type { UseMutationResult, UseQueryOptions } from '@tanstack/react-query';
import { entitlementsAtom } from './atoms';

export const useEntitlements = (
  organizationId?: string,
  config?: UseQueryOptions<TGetEntitlementsResponse>,
): ReturnType<typeof useQuery<TGetEntitlementsResponse>> => {
  const query = useQuery<TGetEntitlementsResponse>(
    [QueryKeys.billing, organizationId],
    () => dataService.getEntitlements(organizationId),
    {
      // Limits gate spend, so a stale-but-present matrix beats a blank one.
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      ...config,
    },
  );

  useEffect(() => {
    if (query.data?.entitlements) {
      getDefaultStore().set(entitlementsAtom, query.data.entitlements);
    }
  }, [query.data]);

  return query;
};

export const useSetEntitlementMutation = (): UseMutationResult<
  Awaited<ReturnType<typeof dataService.setEntitlement>>,
  unknown,
  { plan: TEntitlementPlan; resource: TEntitlementResource; payload: TSetEntitlementRequest },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ plan, resource, payload }) => dataService.setEntitlement(plan, resource, payload),
    {
      onSuccess: () => {
        void queryClient.invalidateQueries([QueryKeys.billing]);
      },
    },
  );
};
