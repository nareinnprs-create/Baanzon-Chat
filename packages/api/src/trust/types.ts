import type { Response } from 'express';
import type {
  TTrustScoreInput,
  TTrustScore,
  TTrustRequest,
  TTrustWeights,
} from 'librechat-data-provider';
import type { ServerRequest } from '~/types/http';

/**
 * The Trust Engine's service surface (ROADMAP B6 / A7.1). Stateless by audit:
 * A7.1 found no persisted trust-evidence contract and no consumer beyond the
 * (not-yet-built) TrustIndicator badge, so the engine scores only what
 * travels on the request. `packages/api` keeps it alias-identical.
 */
export type TrustScorePayload = TTrustScore;

export interface TrustService {
  /**
   * Scores one entity's evidence: weights resolve defaults <- the caller's
   * baanzon.yaml `trustEngine` levers (mirroring the flags config layering).
   */
  evaluate(params: {
    input: TTrustScoreInput;
    config?: Partial<TTrustWeights>;
  }): Promise<TrustScorePayload>;
}

export type TrustServiceDeps = Record<string, never>;

/** The wire request the handlers parse out of `req.params`/`req.query`. */
export type TrustQuery = TTrustRequest;

export interface TrustHandlers {
  /** `GET /api/trust/:entityType/:id?credibility=&ageDays=&positive=&negative=`. */
  getTrust: (req: ServerRequest, res: Response) => Promise<Response>;
}

export interface TrustHandlersDeps {
  service: TrustService;
}
