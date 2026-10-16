import { HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@librechat/agents/langchain/messages';
import { hydrateMissingIndexTokenCounts } from './tokenMap';
import type { TokenCounter } from './tokenMap';

const messages: BaseMessage[] = [
  new HumanMessage('alpha'),
  new HumanMessage('bravo charlie'),
  new HumanMessage('delta echo foxtrot'),
];

const counter = (value: number): jest.Mock<number, [BaseMessage]> =>
  jest.fn((_message: BaseMessage) => value);

describe('hydrateMissingIndexTokenCounts', () => {
  it('computes a count for every message when no map is provided', () => {
    const tokenCounter = counter(7);

    const result = hydrateMissingIndexTokenCounts({
      messages,
      indexTokenCountMap: undefined,
      tokenCounter: tokenCounter as unknown as TokenCounter,
    });

    expect(result).toEqual({ 0: 7, 1: 7, 2: 7 });
    expect(tokenCounter).toHaveBeenCalledTimes(3);
    expect(tokenCounter).toHaveBeenCalledWith(messages[0]);
    expect(tokenCounter).toHaveBeenCalledWith(messages[2]);
  });

  it('preserves precomputed counts and only computes the missing indices', () => {
    const tokenCounter = counter(3);

    const result = hydrateMissingIndexTokenCounts({
      messages,
      indexTokenCountMap: { 0: 100, 2: 42 },
      tokenCounter: tokenCounter as unknown as TokenCounter,
    });

    expect(result).toEqual({ 0: 100, 1: 3, 2: 42 });
    expect(tokenCounter).toHaveBeenCalledTimes(1);
    expect(tokenCounter).toHaveBeenCalledWith(messages[1]);
  });

  it('recomputes zero, negative and NaN counts instead of trusting them', () => {
    const tokenCounter = counter(5);

    const result = hydrateMissingIndexTokenCounts({
      messages,
      indexTokenCountMap: { 0: 0, 1: -4, 2: Number.NaN },
      tokenCounter: tokenCounter as unknown as TokenCounter,
    });

    expect(result).toEqual({ 0: 5, 1: 5, 2: 5 });
    expect(tokenCounter).toHaveBeenCalledTimes(3);
  });

  it('recomputes Infinity and undefined values', () => {
    const tokenCounter = counter(2);

    const result = hydrateMissingIndexTokenCounts({
      messages,
      indexTokenCountMap: { 0: Number.POSITIVE_INFINITY, 1: undefined, 2: 9 },
      tokenCounter: tokenCounter as unknown as TokenCounter,
    });

    expect(result).toEqual({ 0: 2, 1: 2, 2: 9 });
    expect(tokenCounter).toHaveBeenCalledTimes(2);
  });

  it('keeps valid map entries that sit beyond the message list', () => {
    const tokenCounter = counter(1);

    const result = hydrateMissingIndexTokenCounts({
      messages: [messages[0]],
      indexTokenCountMap: { 0: 10, 5: 99 },
      tokenCounter: tokenCounter as unknown as TokenCounter,
    });

    expect(result).toEqual({ 0: 10, 5: 99 });
    expect(tokenCounter).not.toHaveBeenCalled();
  });

  it('returns an empty map for an empty message list', () => {
    const tokenCounter = counter(1);

    const result = hydrateMissingIndexTokenCounts({
      messages: [],
      indexTokenCountMap: {},
      tokenCounter: tokenCounter as unknown as TokenCounter,
    });

    expect(result).toEqual({});
    expect(tokenCounter).not.toHaveBeenCalled();
  });
});
