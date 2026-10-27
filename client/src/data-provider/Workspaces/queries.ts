import { useQuery } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';
import type { OrganizationListResponse, WorkspaceListResponse } from 'librechat-data-provider';
import type { UseQueryOptions } from '@tanstack/react-query';

/**
 * The organizations the caller belongs to — the cascade root the workspace
 * list hangs off, since `GET /api/workspaces` is organization-scoped.
 */
export const useOrganizationsQuery = (
  config?: UseQueryOptions<OrganizationListResponse>,
): ReturnType<typeof useQuery<OrganizationListResponse>> =>
  useQuery<OrganizationListResponse>(
    [QueryKeys.organizations],
    () => dataService.listOrganizations(),
    {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      ...config,
    },
  );

/** The workspaces of one organization; disabled until an organization is named. */
export const useWorkspacesQuery = (
  organizationId?: string | null,
  config?: UseQueryOptions<WorkspaceListResponse>,
): ReturnType<typeof useQuery<WorkspaceListResponse>> =>
  useQuery<WorkspaceListResponse>(
    [QueryKeys.workspaces, organizationId],
    () => dataService.listWorkspaces(organizationId ?? ''),
    {
      enabled: Boolean(organizationId),
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      ...config,
    },
  );
