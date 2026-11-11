import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MutationKeys, QueryKeys, dataService } from 'librechat-data-provider';
import type {
  TAdminApplyPaymentRequest,
  TAdminApplyPaymentResponse,
  TAdminDodoPaymentsResponse,
} from 'librechat-data-provider';

export function useAdminDodoPaymentsQuery(enabled = true) {
  return useQuery<TAdminDodoPaymentsResponse>(
    [QueryKeys.adminDodoPayments],
    () => dataService.getAdminDodoPayments(),
    { enabled, retry: false, refetchOnWindowFocus: false },
  );
}

export function useApplyAdminPaymentMutation() {
  const queryClient = useQueryClient();
  return useMutation<TAdminApplyPaymentResponse, Error, TAdminApplyPaymentRequest>(
    [MutationKeys.applyAdminPayment],
    (payload) => dataService.applyAdminDodoPayment(payload),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.adminDodoPayments]);
        queryClient.invalidateQueries([QueryKeys.billingSubscription]);
      },
    },
  );
}
