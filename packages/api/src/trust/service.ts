import {
  TRUST_CONFLICTING_SPREAD,
  TRUST_ENTITY_TYPES,
  TRUST_SCORE_MAX,
  TRUST_SCORE_MIN,
  TRUST_THRESHOLD_SUPPORTED,
  TRUST_THRESHOLD_VERIFIED,
  trustEngineConfigSchema,
  type TTrustEntityType,
  type TTrustFeedbackInput,
  type TTrustScoreInput,
  type TTrustSourceInput,
  type TTrustState,
  type TTrustWeights,
} from 'librechat-data-provider';
import type { TrustService, TrustServiceDeps, TrustScorePayload } from './types';

/**
 * Resolves the effective composite weights: defaults <- the baanzon.yaml
 * `trustEngine` levers. The schema carries the defaults, so an absent lever
 * block reproduces the shipped engine; malformed lever values fall back to
 * the same defaults instead of throwing.
 */
export function resolveTrustWeights(config?: Partial<TTrustWeights>): TTrustWeights {
  const parsed = trustEngineConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : trustEngineConfigSchema.parse({});
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

/** One path to a finite number: any malformed wire value lands on 0. */
function toFiniteNumber(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value.trim()) : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Clamps one cited source into protocol range: credibility into 0..100 and
 * ageDays at a 0 floor, so a hostile wire value can only mute or retire a
 * source — it can never inflate past a well-evidenced one.
 */
export function sanitizeSource(source: TTrustSourceInput): TTrustSourceInput {
  return {
    credibility: clamp(toFiniteNumber(source.credibility), TRUST_SCORE_MIN, TRUST_SCORE_MAX),
    ageDays: clamp(toFiniteNumber(source.ageDays ?? 0), 0, Number.MAX_SAFE_INTEGER),
  };
}

/** Non-negative feedback counts; an all-zero signal reads as "no feedback". */
export function sanitizeFeedback(feedback: TTrustFeedbackInput): TTrustFeedbackInput {
  const positive = clamp(Math.round(toFiniteNumber(feedback.positive)), 0, Number.MAX_SAFE_INTEGER);
  const negative = clamp(Math.round(toFiniteNumber(feedback.negative)), 0, Number.MAX_SAFE_INTEGER);
  return { positive, negative };
}

/**
 * Pure composite (the engine's whole truth): each source's credibility decays
 * by its age with a half-life in days, decayed credibilities average
 * equally, and that blends with the positive-feedback ratio (0..100) at
 * `sourceWeight`; the sum clamps to an integer 0..100. Fully deterministic —
 * no clock, no network, no store.
 *
 * State ladder: `conflicting` when two-or-more decayed sources disagree by at
 * least `TRUST_CONFLICTING_SPREAD`, then `verified` at
 * `TRUST_THRESHOLD_VERIFIED` or above with at least one source in evidence (a
 * bare feedback ratio never verifies), `supported` at
 * `TRUST_THRESHOLD_SUPPORTED`, else `uncertain`.
 */
export function scoreTrust(input: TTrustScoreInput, weights: TTrustWeights): TrustScorePayload {
  const sources = (input.sources ?? []).map(sanitizeSource);
  const feedback = sanitizeFeedback(input.feedback ?? { positive: 0, negative: 0 });

  const halfLife = Math.max(1, weights.recencyHalfLifeDays);
  const sourceWeight = clamp(weights.sourceWeight, 0, 1);
  const feedbackWeight = clamp(1 - sourceWeight, 0, 1);

  const decayed = sources.map((source) => ({
    credibility: source.credibility,
    ageDays: source.ageDays ?? 0,
    decayed: source.credibility * Math.pow(0.5, (source.ageDays ?? 0) / halfLife),
  }));

  const sourceScore = decayed.length
    ? decayed.reduce((total, source) => total + source.decayed, 0) / decayed.length
    : 0;
  const sourcesCount = sources.length;
  const spread =
    sourcesCount >= 2
      ? Math.max(...decayed.map((source) => source.decayed)) -
        Math.min(...decayed.map((source) => source.decayed))
      : 0;

  const feedbackTotal = feedback.positive + feedback.negative;
  const feedbackScore =
    feedbackTotal > 0 ? (feedback.positive / feedbackTotal) * TRUST_SCORE_MAX : null;

  let score: number;
  if (sourceScore > 0 && feedbackScore !== null) {
    score = sourceWeight * sourceScore + feedbackWeight * feedbackScore;
  } else if (sourceScore > 0) {
    score = sourceScore;
  } else if (feedbackScore !== null) {
    score = feedbackScore;
  } else {
    score = 0;
  }

  const finalScore = Math.round(clamp(score, TRUST_SCORE_MIN, TRUST_SCORE_MAX));

  let state: TTrustState;
  if (spread >= TRUST_CONFLICTING_SPREAD) {
    state = 'conflicting';
  } else if (finalScore >= TRUST_THRESHOLD_VERIFIED && sourcesCount > 0) {
    state = 'verified';
  } else if (finalScore >= TRUST_THRESHOLD_SUPPORTED) {
    state = 'supported';
  } else {
    state = 'uncertain';
  }

  return { score: finalScore, state, sourcesCount };
}

/**
 * Stateless trust service. The score is a pure function of the evidence on
 * the request and the resolved config levers — nothing reaches for an app
 * singleton (AGENTS.md DI policy) and there is deliberately no store seam:
 * the audited contract has no persisted trust rows to read or write.
 */
export function createTrustService(_deps: TrustServiceDeps = {}): TrustService {
  const service: TrustService = {
    async evaluate({ input, config }) {
      const weights = resolveTrustWeights(config);
      return scoreTrust(input, weights);
    },
  };
  void _deps;
  return service;
}

/** Narrow a wire string to a registered entity type (no widening at call sites). */
export function asTrustEntityType(value: string): TTrustEntityType | null {
  return (TRUST_ENTITY_TYPES as readonly string[]).includes(value)
    ? (value as TTrustEntityType)
    : null;
}
