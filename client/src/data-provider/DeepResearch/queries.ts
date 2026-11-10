import { useMutation } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';
import type {
  TDeepResearchPlan,
  TDeepResearchPlanRequest,
  TDeepResearchReport,
  TDeepResearchReportRequest,
} from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';

export const useCreateDeepResearchPlanMutation = (): UseMutationResult<
  TDeepResearchPlan,
  unknown,
  TDeepResearchPlanRequest,
  unknown
> => {
  return useMutation(
    (payload: TDeepResearchPlanRequest) => dataService.createDeepResearchPlan(payload),
    {
      mutationKey: [QueryKeys.deepResearchPlan],
    },
  );
};

export const useBuildDeepResearchReportMutation = (): UseMutationResult<
  TDeepResearchReport,
  unknown,
  TDeepResearchReportRequest,
  unknown
> => {
  return useMutation(
    (payload: TDeepResearchReportRequest) => dataService.buildDeepResearchReport(payload),
    { mutationKey: [QueryKeys.deepResearchReport] },
  );
};
