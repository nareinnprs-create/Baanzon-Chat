import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type {
  TAdminUsersListParams,
  TAdminUsersResponse,
  TAdminUsersSearchResponse,
} from 'librechat-data-provider';

/** Offset-paged users list; disabled until params are provided. */
export function useAdminUsersQuery(params?: TAdminUsersListParams) {
  return useQuery<TAdminUsersResponse>(
    [QueryKeys.adminUsers, 'list', params?.limit, params?.offset],
    () => dataService.listAdminUsers(params),
    { enabled: params != null, retry: false, refetchOnWindowFocus: false, keepPreviousData: true },
  );
}

/** Search-as-you-type; the backend requires at least 2 characters. */
export function useAdminUsersSearchQuery(q: string) {
  return useQuery<TAdminUsersSearchResponse>(
    [QueryKeys.adminUsers, 'search', q],
    () => dataService.searchAdminUsers({ q }),
    {
      enabled: q.trim().length >= 2,
      retry: false,
      refetchOnWindowFocus: false,
      keepPreviousData: true,
    },
  );
}
