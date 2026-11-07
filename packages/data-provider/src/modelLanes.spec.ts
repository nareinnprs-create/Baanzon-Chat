import { MODEL_LANES, modelLaneConfigSchema, modelLaneSchema } from './modelLanes';

describe('model lanes', () => {
  it('keeps the public lane vocabulary stable', () => {
    expect(MODEL_LANES).toEqual([
      'fast',
      'balanced',
      'reasoning',
      'vision',
      'coding',
      'local',
      'embedding',
      'reranker',
    ]);
  });

  it('rejects provider names as user-facing lanes', () => {
    expect(modelLaneSchema.safeParse('gpt-5').success).toBe(false);
  });

  it('supplies safe defaults and rejects unknown configuration', () => {
    expect(modelLaneConfigSchema.parse({})).toEqual({
      enabled: true,
      defaultLane: 'balanced',
      fallbackLane: 'fast',
      visionModels: [],
    });
    expect(modelLaneConfigSchema.safeParse({ unknown: true }).success).toBe(false);
  });
});
