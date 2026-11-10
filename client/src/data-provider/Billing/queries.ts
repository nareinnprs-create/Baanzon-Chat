import { useEffect } from 'react';
import { getDefaultStore } from 'jotai';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  TBillingProductsResponse,
  TCheckoutRequest,
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

/** Public pricing catalog: plan tiers and credit packs with INR prices. */
export const useBillingProducts = (
  config?: UseQueryOptions<TBillingProductsResponse>,
): ReturnType<typeof useQuery<TBillingProductsResponse>> =>
  useQuery<TBillingProductsResponse>(
    [QueryKeys.billingProducts],
    () => dataService.getBillingProducts(),
    {
      // Prices move only with a deploy; refetching on focus is noise.
      staleTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      ...config,
    },
  );

/** Opens a Dodo hosted checkout (a mock redirect under DODO_MODE=mock) for the selection. */
export const useCreateCheckout = (): UseMutationResult<
  Awaited<ReturnType<typeof dataService.createCheckoutSession>>,
  unknown,
  TCheckoutRequest,
  unknown
> => useMutation((payload) => dataService.createCheckoutSession(payload));
