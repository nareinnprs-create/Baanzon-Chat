import {
  TRUST_ENGINE_DEFAULTS,
  TRUST_RECENCY_HALF_LIFE_DAYS_DEFAULT,
  TRUST_SOURCE_WEIGHT_DEFAULT,
} from 'librechat-data-provider';
import {
  asTrustEntityType,
  createTrustService,
  resolveTrustWeights,
  sanitizeFeedback,
  sanitizeSource,
  scoreTrust,
} from './service';
import type { TTrustScoreInput } from 'librechat-data-provider';
import type { TrustService } from './types';

describe('resolveTrustWeights', () => {
  it('resolves the ship defaults when no lever block exists', () => {
    expect(resolveTrustWeights(undefined).sourceWeight).toBe(TRUST_SOURCE_WEIGHT_DEFAULT);
    expect(resolveTrustWeights(undefined).recencyHalfLifeDays).toBe(
      TRUST_RECENCY_HALF_LIFE_DAYS_DEFAULT,
    );
  });

  it('applies config levers over the defaults', () => {
    expect(resolveTrustWeights({ sourceWeight: 1, recencyHalfLifeDays: 7 })).toEqual({
      sourceWeight: 1,
      recencyHalfLifeDays: 7,
    });
  });

  it('falls back to the shipped defaults on a malformed lever value instead of throwing', () => {
    expect(resolveTrustWeights({ sourceWeight: 7 as unknown as number })).toEqual(
      TRUST_ENGINE_DEFAULTS,
    );
  });
});

describe('sanitizeSource', () => {
  it('clamps credibility into 0..100 and ageDays onto a 0 floor', () => {
    expect(sanitizeSource({ credibility: 150, ageDays: -3 })).toEqual({
      credibility: 100,
      ageDays: 0,
    });
    expect(sanitizeSource({ credibility: -20, ageDays: 2 })).toEqual({
      credibility: 0,
      ageDays: 2,
    });
  });

  it('lands malformed wire values on 0 so a hostile value mutes, never fabricates', () => {
    expect(sanitizeSource({ credibility: NaN, ageDays: NaN })).toEqual({
      credibility: 0,
      ageDays: 0,
    });
    expect(sanitizeSource({ credibility: '90' as unknown as number, ageDays: 1 })).toEqual({
      credibility: 90,
      ageDays: 1,
    });
  });

  it('treats a missing age as brand new (full weight)', () => {
    expect(sanitizeSource({ credibility: 80 })).toEqual({ credibility: 80, ageDays: 0 });
  });
});

describe('sanitizeFeedback', () => {
  it('clamps counts onto a non-negative integer floor', () => {
    expect(sanitizeFeedback({ positive: -5, negative: 2.7 })).toEqual({ positive: 0, negative: 3 });
  });

  it('passes well-formed counts through unchanged', () => {
    expect(sanitizeFeedback({ positive: 3, negative: 1 })).toEqual({ positive: 3, negative: 1 });
  });
});

describe('scoreTrust — composite matrix', () => {
  it('scores a fresh, credible source plus a positive feedback draw as verified', () => {
    const verdict = scoreTrust(
      { sources: [{ credibility: 100, ageDays: 0 }], feedback: { positive: 3, negative: 1 } },
      TRUST_ENGINE_DEFAULTS,
    );
    /** 0.6 * 100 + 0.4 * (3/4 * 100) = 90. */
    expect(verdict).toEqual({ score: 90, state: 'verified', sourcesCount: 1 });
  });

  it('averages sources equally and never verifies without a source in evidence', () => {
    const verdict = scoreTrust(
      {
        sources: [{ credibility: 80 }, { credibility: 50 }],
        feedback: { positive: 1, negative: 0 },
      },
      TRUST_ENGINE_DEFAULTS,
    );
    /** source mean (80 + 50) / 2 = 65; feedback ratio 100. → 0.6*65 + 0.4*100 = 79. */
    expect(verdict.score).toBe(79);
    expect(verdict.state).toBe('supported');
    expect(verdict.sourcesCount).toBe(2);
  });

  it('decays at exactly one half-life to half the credibility', () => {
    const fresh = scoreTrust({ sources: [{ credibility: 80, ageDays: 0 }] }, TRUST_ENGINE_DEFAULTS);
    const aged = scoreTrust(
      { sources: [{ credibility: 80, ageDays: TRUST_RECENCY_HALF_LIFE_DAYS_DEFAULT }] },
      TRUST_ENGINE_DEFAULTS,
    );
    expect(fresh.score).toBe(80);
    expect(aged.score).toBe(40);
  });

  it('retires a source far past several half-lives down to near-zero, not below it', () => {
    const verdict = scoreTrust(
      { sources: [{ credibility: 100, ageDays: 30 * 20 }] },
      TRUST_ENGINE_DEFAULTS,
    );
    expect(verdict.score).toBe(0);
    expect(verdict.state).toBe('uncertain');
  });

  it('does not verify a bare positive feedback ratio with zero sources', () => {
    const verdict = scoreTrust(
      { sources: [], feedback: { positive: 5, negative: 0 } },
      {
        ...TRUST_ENGINE_DEFAULTS,
        sourceWeight: 1,
      },
    );
    expect(verdict.score).toBe(100);
    expect(verdict.state).toBe('supported');
  });

  it('answers an evidence-free input with 0 and uncertain', () => {
    expect(scoreTrust({ sources: [] }, TRUST_ENGINE_DEFAULTS)).toEqual({
      score: 0,
      state: 'uncertain',
      sourcesCount: 0,
    });
    expect(
      scoreTrust(
        { sources: [{ credibility: 0 }], feedback: { positive: 0, negative: 0 } },
        TRUST_ENGINE_DEFAULTS,
      ).state,
    ).toBe('uncertain');
  });

  it('answers conflicting when decayed sources disagree beyond the protocol spread', () => {
    const verdict = scoreTrust(
      {
        sources: [
          { credibility: 100, ageDays: 0 },
          { credibility: 60, ageDays: TRUST_RECENCY_HALF_LIFE_DAYS_DEFAULT },
        ],
      },
      TRUST_ENGINE_DEFAULTS,
    );
    /** decayed [100, 30]; spread 70 >= 40 beats the 65 mean that would read `supported`. */
    expect(verdict.score).toBe(65);
    expect(verdict.state).toBe('conflicting');
  });

  it('keeps a tight source spread out of the conflicting state', () => {
    const verdict = scoreTrust(
      {
        sources: [
          { credibility: 100, ageDays: 0 },
          { credibility: 99, ageDays: 0 },
        ],
      },
      TRUST_ENGINE_DEFAULTS,
    );
    expect(verdict.score).toBe(100);
    expect(verdict.state).toBe('verified');
  });

  it('moves the composite with the sourceWeight lever (feedback-only draw at 1)', () => {
    const verdict = scoreTrust(
      { sources: [{ credibility: 100 }], feedback: { positive: 1, negative: 1 } },
      { sourceWeight: 1, recencyHalfLifeDays: TRUST_RECENCY_HALF_LIFE_DAYS_DEFAULT },
    );
    expect(verdict.score).toBe(100);
  });

  it('stays deterministic across repeated calls (no clock, no store)', () => {
    const input: TTrustScoreInput = {
      sources: [{ credibility: 70, ageDays: 4 }],
      feedback: { positive: 2, negative: 1 },
    };
    const first = scoreTrust(input, TRUST_ENGINE_DEFAULTS);
    const second = scoreTrust(input, TRUST_ENGINE_DEFAULTS);
    expect(second).toEqual(first);
  });

  it('rounds to an integer and stays inside 0..100 under absurd but clamped inputs', () => {
    const verdict = scoreTrust(
      {
        sources: [{ credibility: 100 }, { credibility: 100 }],
        feedback: { positive: 7, negative: 1 },
      },
      { sourceWeight: 0.5, recencyHalfLifeDays: 1 },
    );
    expect(Number.isInteger(verdict.score)).toBe(true);
    expect(verdict.score).toBeLessThanOrEqual(100);
    expect(verdict.score).toBeGreaterThanOrEqual(0);
  });
});

describe('createTrustService', () => {
  it('evaluates through the injected weights layering (defaults <- config)', async () => {
    const service: TrustService = createTrustService();
    const verdict = await service.evaluate({
      input: { sources: [{ credibility: 100, ageDays: 0 }] },
      config: { sourceWeight: 1 },
    });
    expect(verdict).toEqual({ score: 100, state: 'verified', sourcesCount: 1 });
  });

  it('evaluates with defaults when the caller passes no config block', async () => {
    const service: TrustService = createTrustService();
    const verdict = await service.evaluate({
      input: { sources: [{ credibility: 100, ageDays: TRUST_RECENCY_HALF_LIFE_DAYS_DEFAULT }] },
    });
    expect(verdict.score).toBe(50);
    expect(verdict.state).toBe('uncertain');
  });
});

describe('asTrustEntityType', () => {
  it('narrows registered types and rejects unknown ones', () => {
    expect(asTrustEntityType('message')).toBe('message');
    expect(asTrustEntityType('agent')).toBe('agent');
    expect(asTrustEntityType('convo')).toBeNull();
    expect(asTrustEntityType('')).toBeNull();
  });
});
