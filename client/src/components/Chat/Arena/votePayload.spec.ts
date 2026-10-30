import { buildArenaVotePayload, getArenaLaneLabel } from './votePayload';
import type { ArenaLaneState } from './votePayload';

const readyLane = (over: Partial<ArenaLaneState> = {}): ArenaLaneState => ({
  model: 'gpt-4o',
  spec: null,
  label: 'GPT-4o',
  latestMessageId: 'msg-1',
  error: false,
  isUserMessage: false,
  ...over,
});

describe('buildArenaVotePayload', () => {
  it('returns null when there is no conversation id', () => {
    const payload = buildArenaVotePayload({
      conversationId: null,
      lane0: readyLane(),
      lane1: readyLane(),
      choice: 'lane0',
    });
    expect(payload).toBeNull();
  });

  it('returns null when either lane has no tail message yet', () => {
    const payload = buildArenaVotePayload({
      conversationId: 'convo-1',
      lane0: readyLane({ latestMessageId: null }),
      lane1: readyLane(),
      choice: 'lane0',
    });
    expect(payload).toBeNull();
  });

  it('returns null when a tail is errored or is still the user message', () => {
    const errored = buildArenaVotePayload({
      conversationId: 'convo-1',
      lane0: readyLane({ error: true }),
      lane1: readyLane(),
      choice: 'lane0',
    });
    const userTail = buildArenaVotePayload({
      conversationId: 'convo-1',
      lane0: readyLane(),
      lane1: readyLane({ isUserMessage: true }),
      choice: 'lane1',
    });
    expect(errored).toBeNull();
    expect(userTail).toBeNull();
  });

  it('records a lane0 win on that lane with the model to continue with', () => {
    const payload = buildArenaVotePayload({
      conversationId: 'convo-1',
      lane0: readyLane({ model: 'm-a', spec: 'spec-a', label: 'Model A' }),
      lane1: readyLane({ model: 'm-b', label: 'Model B', latestMessageId: 'msg-2' }),
      choice: 'lane0',
    });
    expect(payload).toEqual({
      conversationId: 'convo-1',
      messageId: 'msg-1',
      winner: { model: 'm-a', spec: 'spec-a', label: 'Model A' },
      feedback: {
        rating: 'thumbsUp',
        tag: 'arena_winner',
        text: 'arena-winner: Model A',
      },
    });
  });

  it('records a lane1 win on that lane', () => {
    const payload = buildArenaVotePayload({
      conversationId: 'convo-1',
      lane0: readyLane({ latestMessageId: 'msg-1' }),
      lane1: readyLane({ model: 'm-b', label: 'Model B', latestMessageId: 'msg-2' }),
      choice: 'lane1',
    });
    expect(payload?.messageId).toBe('msg-2');
    expect(payload?.winner).toEqual({ model: 'm-b', spec: null, label: 'Model B' });
    expect(payload?.feedback.text).toBe('arena-winner: Model B');
  });

  it('records a tie with no winner to switch to', () => {
    const payload = buildArenaVotePayload({
      conversationId: 'convo-1',
      lane0: readyLane({ label: 'Model A' }),
      lane1: readyLane({ model: 'm-b', label: 'Model B', latestMessageId: 'msg-2' }),
      choice: 'tie',
    });
    expect(payload?.winner).toBeNull();
    expect(payload?.feedback.text).toBe('arena-tie: Model A vs Model B');
  });
});

describe('getArenaLaneLabel', () => {
  const specs = [{ name: 'spec-a', label: 'Model A' }];

  it('prefers the spec label', () => {
    expect(getArenaLaneLabel({ model: 'm-a', spec: 'spec-a' }, specs)).toBe('Model A');
  });

  it('falls back to the spec name and then the raw model', () => {
    expect(getArenaLaneLabel({ model: 'm-a', spec: 'unknown' }, specs)).toBe('unknown');
    expect(getArenaLaneLabel({ model: 'm-a', spec: null }, specs)).toBe('m-a');
    expect(getArenaLaneLabel(null, specs)).toBe('—');
  });
});
