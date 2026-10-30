import { aggregateMessageLists, emptyUsage } from '../aggregate';
import type { TMessage } from 'librechat-data-provider';

const msg = (overrides: Partial<TMessage>): TMessage => overrides as TMessage;

describe('aggregateMessageLists', () => {
  it('returns zeros for empty input', () => {
    expect(aggregateMessageLists([])).toEqual(emptyUsage);
    expect(aggregateMessageLists([[]])).toEqual(emptyUsage);
    expect(aggregateMessageLists([undefined as unknown as TMessage[]])).toEqual(emptyUsage);
  });

  it('splits tokens in (user) and out (assistant) and counts messages', () => {
    const total = aggregateMessageLists([
      [
        msg({ messageId: 'u1', isCreatedByUser: true, tokenCount: 120 }),
        msg({ messageId: 'a1', isCreatedByUser: false, tokenCount: 340 }),
        msg({ messageId: 'u2', isCreatedByUser: true, tokenCount: 80 }),
      ],
    ]);
    expect(total).toEqual({
      conversations: 1,
      messages: 3,
      tokensIn: 200,
      tokensOut: 340,
      totalTokens: 540,
    });
  });

  it('skips missing or invalid token counts and only counts non-empty conversations', () => {
    const total = aggregateMessageLists([
      [msg({ messageId: 'a1', isCreatedByUser: false, tokenCount: 50 })],
      [msg({ messageId: 'a2', isCreatedByUser: false })],
      [msg({ messageId: 'a3', isCreatedByUser: false, tokenCount: Number.NaN })],
      [],
    ]);
    expect(total.conversations).toBe(3);
    expect(total.messages).toBe(3);
    expect(total.tokensOut).toBe(50);
    expect(total.totalTokens).toBe(50);
  });
});
