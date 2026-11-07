import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MutationKeys, QueryKeys, dataService } from 'librechat-data-provider';
import type {
  TAdminProviderTestRequest,
  TAdminProviderTestResponse,
  TAdminProvidersResponse,
} from 'librechat-data-provider';

export function useAdminProvidersQuery(enabled = true) {
  return useQuery<TAdminProvidersResponse>(
    [QueryKeys.adminProviders],
    () => dataService.getAdminProviders(),
    { enabled, retry: false, refetchOnWindowFocus: false },
  );
}

export function useTestAdminProviderMutation() {
  const queryClient = useQueryClient();
  return useMutation<TAdminProviderTestResponse, Error, TAdminProviderTestRequest>(
    [MutationKeys.testAdminProvider],
    (payload) => dataService.testAdminProvider(payload),
    {
      onSuccess: () => {
        /* Model catalogs may be cached per endpoint; refresh after a probe. */
        queryClient.invalidateQueries([QueryKeys.adminProviders]);
      },
    },
  );
}
