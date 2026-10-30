import { logger } from '@librechat/data-schemas';
import { type TTrustRequest, type TTrustWeights } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { asTrustEntityType } from './service';
import type { TrustHandlers, TrustHandlersDeps, TrustQuery } from './types';

const AUTH_REQUIRED = 'Authentication required';
const UNKNOWN_ENTITY_TYPE = 'Unknown trust entity type';
const INVALID_ENTITY_ID = 'Invalid trust entity id';

/** The longest registered-entity id on the wire; longer ids answer 400. */
const TRUST_MAX_ID_LENGTH = 512;

/**
 * The id and the per-source evidence lists land on protocol shape here, so
 * the service only ever sees plain typed objects. Lists parse
 * comma-separated numbers; parse failures land on 0, which the sanitizer
 * legitimately reads as "no contribution" — an unparseable source can mute
 * itself, never fabricate score.
 */
type TrustParseError = 'unknownEntityType' | 'invalidEntityId';

function parseTrustQuery(req: ServerRequest): TrustQuery | TrustParseError {
  const params = (req.params ?? {}) as { entityType?: string; id?: string };
  const entityType = asTrustEntityType(params.entityType ?? '');
  if (!entityType) {
    return 'unknownEntityType';
  }
  const id = params.id;
  if (typeof id !== 'string' || id.trim().length === 0 || id.length > TRUST_MAX_ID_LENGTH) {
    return 'invalidEntityId';
  }

  const numbers = (raw: unknown): number[] | undefined => {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return undefined;
    }
    return raw.split(',').map((token) => (Number.isFinite(Number(token)) ? Number(token) : 0));
  };

  const limit = (raw: unknown): number | undefined => {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return undefined;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const input: TTrustRequest = {
    entityType,
    id: id.trim(),
  };
  const credibility = numbers(req.query.credibility);
  const ageDays = numbers(req.query.ageDays);
  const positive = limit(req.query.positive);
  const negative = limit(req.query.negative);
  if (credibility) {
    input.credibility = credibility;
  }
  if (ageDays) {
    input.ageDays = ageDays;
  }
  if (positive !== undefined) {
    input.positive = positive;
  }
  if (negative !== undefined) {
    input.negative = negative;
  }
  return input;
}

/**
 * The config lever for this request; `trustEngineConfigSchema` carries the
 * defaults, so an absent or malformed lever block reproduces the shipped
 * engine unchanged (same layering rule as the flags handlers).
 */
export function resolveConfigLevers(req: ServerRequest): Partial<TTrustWeights> {
  const raw = req.config?.config?.trustEngine;
  return raw ?? {};
}

/**
 * Express handlers for the stateless trust engine. The injected service does
 * the work; there is no store, but the auth and entity-registry gates still
 * run before scoring so the endpoint cannot become an unauthenticated oracle.
 */
export function createTrustHandlers(deps: TrustHandlersDeps): TrustHandlers {
  const { service } = deps;

  async function getTrust(req: ServerRequest, res: Response): Promise<Response> {
    const user = req.user?._id?.toString() ?? req.user?.id;
    if (!user) {
      /** Defense in depth for direct reuse; the route carries requireJwtAuth. */
      return res.status(401).json({ error: AUTH_REQUIRED });
    }

    const parsed = parseTrustQuery(req);
    if (parsed === 'unknownEntityType') {
      return res.status(400).json({ error: UNKNOWN_ENTITY_TYPE });
    }
    if (parsed === 'invalidEntityId') {
      return res.status(400).json({ error: INVALID_ENTITY_ID });
    }
    const entity = parsed;

    try {
      const weights = resolveConfigLevers(req);
      const verdict = await service.evaluate({
        input: {
          sources: (entity.credibility ?? []).map((credibility, index) => ({
            credibility,
            ageDays: entity.ageDays?.[index],
          })),
          feedback:
            entity.positive !== undefined || entity.negative !== undefined
              ? { positive: entity.positive ?? 0, negative: entity.negative ?? 0 }
              : undefined,
        },
        config: weights,
      });

      const payload = {
        entityType: entity.entityType,
        id: entity.id,
        trust: verdict,
      };
      return res.status(200).json(payload);
    } catch (error) {
      logger.error('[trust] Error evaluating trust', error);
      return res.status(500).json({ error: 'Error evaluating trust' });
    }
  }

  return { getTrust };
}
