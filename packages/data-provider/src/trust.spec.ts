import {
  TRUST_CONFLICTING_SPREAD,
  TRUST_ENGINE_DEFAULTS,
  TRUST_ENTITY_TYPES,
  TRUST_SCORE_MAX,
  TRUST_SCORE_MIN,
  TRUST_STATES,
  TRUST_THRESHOLD_SUPPORTED,
  TRUST_THRESHOLD_VERIFIED,
  trustEngineConfigSchema,
} from './trust';

describe('trustEngineConfigSchema', () => {
  it('defaults reproduce the shipped engine behavior', () => {
    expect(trustEngineConfigSchema.parse({})).toEqual(TRUST_ENGINE_DEFAULTS);
  });

  it('accepts in-range levers and fills the rest from defaults', () => {
    expect(trustEngineConfigSchema.safeParse({ sourceWeight: 1 }).success).toBe(true);
    expect(trustEngineConfigSchema.safeParse({ recencyHalfLifeDays: 90 }).success).toBe(true);
    expect(trustEngineConfigSchema.safeParse({ recencyHalfLifeDays: 90 }).data).toEqual({
      sourceWeight: TRUST_ENGINE_DEFAULTS.sourceWeight,
      recencyHalfLifeDays: 90,
    });
  });

  it('rejects weights outside 0..1, non-integer or out-of-range half-lives and unknown keys', () => {
    expect(trustEngineConfigSchema.safeParse({ sourceWeight: 1.5 }).success).toBe(false);
    expect(trustEngineConfigSchema.safeParse({ sourceWeight: -0.1 }).success).toBe(false);
    expect(trustEngineConfigSchema.safeParse({ recencyHalfLifeDays: 0 }).success).toBe(false);
    expect(trustEngineConfigSchema.safeParse({ recencyHalfLifeDays: 30.5 }).success).toBe(false);
    expect(trustEngineConfigSchema.safeParse({ recencyHalfLifeDays: 3651 }).success).toBe(false);
    expect(trustEngineConfigSchema.safeParse({ feedbackWeight: 0.4 }).success).toBe(false);
  });
});

describe('trust protocol constants', () => {
  it('keeps the state set exactly the blueprint surface (Sources·N is `sourcesCount`, not a state)', () => {
    expect(TRUST_STATES).toEqual(['verified', 'supported', 'uncertain', 'conflicting']);
    expect(TRUST_ENTITY_TYPES).toEqual(['message', 'conversation', 'artifact', 'agent']);
  });

  it('orders the score ladder coherently', () => {
    expect(TRUST_THRESHOLD_VERIFIED).toBeGreaterThan(TRUST_THRESHOLD_SUPPORTED);
    expect(TRUST_THRESHOLD_SUPPORTED).toBeGreaterThan(0);
    expect(TRUST_CONFLICTING_SPREAD).toBeGreaterThan(0);
    expect(TRUST_SCORE_MIN).toBeLessThan(TRUST_SCORE_MAX);
  });
});
