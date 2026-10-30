import { z } from 'zod';

/**
 * The Trust Engine's wire contract (ROADMAP B6 / A7.1):
 * a deterministic, stateless composite score over the evidence carried on the
 * request itself — source credibility, recency decay and user feedback
 * signals. There is no persisted trust evidence exchange yet (that surface is
 * tracked as A7.1b), so prompts and citations hand the engine their inputs and
 * get an integer 0–100 score plus one of the blueprint's TrustIndicator states
 * back. `Sources·N` is not a fifth state; it is the `sourcesCount` field.
 */

/** Entities the engine scores. A new scoreable type is a code change here, not a free-form string. */
export const TRUST_ENTITY_TYPES = ['message', 'conversation', 'artifact', 'agent'] as const;

export type TTrustEntityType = (typeof TRUST_ENTITY_TYPES)[number];

/** TrustIndicator states (Masterblueprint §89 / ROADMAP B6): Verified/Supported/Uncertain/Conflicting. */
export const TRUST_STATES = ['verified', 'supported', 'uncertain', 'conflicting'] as const;

export type TTrustState = (typeof TRUST_STATES)[number];

/** Composite score bounds — the engine clamps, never extrapolates. */
export const TRUST_SCORE_MIN = 0;
export const TRUST_SCORE_MAX = 100;

/** Composite score at or above which an evidenced claim reads `verified`. */
export const TRUST_THRESHOLD_VERIFIED = 80;
/** Composite score at or above which (but below `verified`) it reads `supported`. */
export const TRUST_THRESHOLD_SUPPORTED = 60;
/**
 * Spread between the strongest and weakest recency-decayed source
 * credibilities that answers `conflicting` (applies from two sources up).
 */
export const TRUST_CONFLICTING_SPREAD = 40;

/** Composite score below which a claim reads `uncertain`. */
export const TRUST_THRESHOLD_UNCERTAIN = TRUST_THRESHOLD_SUPPORTED - 1;

/**
 * The two trustEngine config levers (baanzon.yaml `trustEngine.*`). Every
 * other number in the engine is protocol (thresholds/spread above) — levers
 * stay to the pair that actually moves deployments.
 */
export const TRUST_SOURCE_WEIGHT_DEFAULT = 0.6;
export const TRUST_RECENCY_HALF_LIFE_DAYS_DEFAULT = 30;

export const TRUST_ENGINE_DEFAULTS = {
  sourceWeight: TRUST_SOURCE_WEIGHT_DEFAULT,
  recencyHalfLifeDays: TRUST_RECENCY_HALF_LIFE_DAYS_DEFAULT,
} as const;

/**
 * `trustEngine` levers: `sourceWeight` splits the composite between source
 * credibility (weight w) and user feedback (weight 1-w); `recencyHalfLifeDays`
 * is the half-life the recency decay uses (age = one half-life halves that
 * source's contribution). Defaults reproduce the shipped engine behavior.
 */
export const trustEngineConfigSchema = z
  .object({
    sourceWeight: z.number().min(0).max(1).optional().default(TRUST_SOURCE_WEIGHT_DEFAULT),
    recencyHalfLifeDays: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .optional()
      .default(TRUST_RECENCY_HALF_LIFE_DAYS_DEFAULT),
  })
  .strict();

export type TrustEngineConfig = z.infer<typeof trustEngineConfigSchema>;

/** One cited source: how credible (0–100) and how old (days). */
export type TTrustSourceInput = {
  credibility: number;
  ageDays?: number;
};

/** User feedback signals recorded against the entity. */
export type TTrustFeedbackInput = {
  positive: number;
  negative: number;
};

/** Everything the engine scores — plain JSON, no storage types. */
export type TTrustScoreInput = {
  sources: TTrustSourceInput[];
  feedback?: TTrustFeedbackInput;
};

/** The resolved lever values the composite runs on. */
export type TTrustWeights = TrustEngineConfig;

/** The engine's verdict. `score` is an integer clamped to `TRUST_SCORE_MIN..TRUST_SCORE_MAX`. */
export type TTrustScore = {
  score: number;
  state: TTrustState;
  /** `Sources·N` — how many sources were in evidence. */
  sourcesCount: number;
};

/** `GET /api/trust/:entityType/:id` request shape (evidence travels on the query). */
export type TTrustRequest = {
  entityType: TTrustEntityType;
  id: string;
  /** Per-source credibility values, 0–100 (out-of-range clamps). */
  credibility?: number[];
  /** Per-source ages in days (negative clamps to 0). */
  ageDays?: number[];
  positive?: number;
  negative?: number;
};

/** `GET /api/trust/:entityType/:id` response shape. */
export type TTrustResponse = {
  entityType: TTrustEntityType;
  id: string;
  trust: TTrustScore;
};
