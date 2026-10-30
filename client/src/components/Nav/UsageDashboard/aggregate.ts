import type { TMessage } from 'librechat-data-provider';

export type UsageScope = 'current' | 'all';

export type UsageAggregate = {
  conversations: number;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
};

export const emptyUsage: UsageAggregate = {
  conversations: 0,
  messages: 0,
  tokensIn: 0,
  tokensOut: 0,
  totalTokens: 0,
};

/**
 * Aggregates cached message lists into a usage total. Per message, `tokenCount`
 * is output tokens for assistant messages and a calibrated prompt-side estimate
 * for user messages, so user/assistant sums approximate tokens in/out.
 */
export function aggregateMessageLists(lists: TMessage[][]): UsageAggregate {
  const total = { ...emptyUsage };
  for (const list of lists) {
    if (!Array.isArray(list) || list.length === 0) {
      continue;
    }
    total.conversations++;
    for (const message of list) {
      total.messages++;
      const tokens =
        typeof message?.tokenCount === 'number' && Number.isFinite(message.tokenCount)
          ? message.tokenCount
          : 0;
      if (message?.isCreatedByUser === true) {
        total.tokensIn += tokens;
      } else {
        total.tokensOut += tokens;
      }
    }
  }
  total.totalTokens = total.tokensIn + total.tokensOut;
  return total;
}
