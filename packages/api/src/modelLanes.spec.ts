import type { ModelLane } from 'librechat-data-provider';
import { assertChatModelLane, assertVisionModel, UnsupportedModelLaneError } from './modelLanes';

describe('assertChatModelLane', () => {
  it.each(['fast', 'balanced', 'reasoning', 'vision', 'coding'] satisfies ModelLane[])(
    'accepts %s for chat requests',
    (lane) => {
      expect(() => assertChatModelLane(lane)).not.toThrow();
    },
  );

  it.each(['local', 'embedding', 'reranker'] satisfies ModelLane[])(
    'rejects %s before chat routing',
    (lane) => {
      expect(() => assertChatModelLane(lane)).toThrow(UnsupportedModelLaneError);
    },
  );

  it('rejects unknown lanes', () => {
    expect(() => assertChatModelLane('experimental')).toThrow('Unknown model lane');
  });

  it('requires an explicitly configured multimodal model', () => {
    expect(() => assertVisionModel('@cf/meta/text-model', [])).toThrow('multimodal');
    expect(() =>
      assertVisionModel('@cf/meta/vision-model', ['@cf/meta/vision-model']),
    ).not.toThrow();
  });
});
