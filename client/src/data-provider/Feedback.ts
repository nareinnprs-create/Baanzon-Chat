import { dataService, QueryKeys } from 'librechat-data-provider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  TCreateFeedbackReport,
  TFeedbackReportListParams,
  TFeedbackReportsResponse,
  TUpdateFeedbackReport,
} from 'librechat-data-provider';

/** Admin triage queue across all users; disabled until filters are provided. */
export function useAllFeedbackReportsQuery(params?: TFeedbackReportListParams) {
  return useQuery<TFeedbackReportsResponse>(
    [QueryKeys.feedback, 'admin', params?.type, params?.status],
    () => dataService.listAllFeedbackReports(params),
    { enabled: params != null, retry: false, refetchOnWindowFocus: false, keepPreviousData: true },
  );
}

export function useCreateFeedbackReportMutation() {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: TCreateFeedbackReport) => dataService.createFeedbackReport(payload),
    {
      onSuccess: () => queryClient.invalidateQueries([QueryKeys.feedback]),
    },
  );
}

export function useUpdateFeedbackStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, patch }: { id: string; patch: TUpdateFeedbackReport }) =>
      dataService.updateFeedbackReportStatus(id, patch),
    {
      onSuccess: () => queryClient.invalidateQueries([QueryKeys.feedback]),
    },
  );
}
