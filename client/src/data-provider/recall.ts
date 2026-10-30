import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import type { TRecallHit } from '~/common';

/** X8 cross-chat recall — GET /api/recall?q= (user-scoped Meili hits). */
export interface TRecallResponse {
  hits: TRecallHit[];
}

export const useRecallQuery = (
  q: string,
  options?: { enabled?: boolean },
): UseQueryResult<TRecallResponse, Error> =>
  useQuery<TRecallResponse, Error>(
    ['recall', q],
    async () => {
      const response = await fetch(`/api/recall?q=${encodeURIComponent(q)}`);
      if (!response.ok) {
        throw new Error(`Recall failed with status ${response.status}`);
      }
      return (await response.json()) as TRecallResponse;
    },
    {
      enabled: (options?.enabled ?? true) && q.trim().length >= 2,
      staleTime: 30000,
    },
  );
