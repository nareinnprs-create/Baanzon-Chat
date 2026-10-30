import { useMutation } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';

export interface TRewriteRequest {
  text: string;
  mode: 'prompt';
  endpoint?: string;
  model?: string;
}

export interface TRewriteResponse {
  text: string;
}

/** Fork-local route (POST /api/rewrite → `{ text }`), inline until it lands in data-provider. */
export const useRewriteMutation = (): UseMutationResult<
  TRewriteResponse,
  Error,
  TRewriteRequest
> =>
  useMutation(async ({ text, mode, endpoint, model }) => {
    const response = await fetch('/api/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, mode, endpoint, model }),
    });
    if (!response.ok) {
      throw new Error(`Rewrite request failed with status ${response.status}`);
    }
    return (await response.json()) as TRewriteResponse;
  });
