import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { TUsageSummary } from 'librechat-data-provider';

/** All-time usage totals for the signed-in user, aggregated server-side. */
export function useUsageSummaryQuery(enabled = true) {
  return useQuery<TUsageSummary>(
    [QueryKeys.usageSummary],
    () => dataService.getUsageSummary(),
    { enabled, retry: false, refetchOnWindowFocus: false, staleTime: 60_000 },
  );
}
