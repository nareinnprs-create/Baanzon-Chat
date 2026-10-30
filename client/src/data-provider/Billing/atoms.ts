import { atom } from 'jotai';
import { PLAN_LIMIT_DEFAULTS } from 'librechat-data-provider';
import type { TEntitlementLimitsMatrix } from 'librechat-data-provider';

/**
 * Resolved plan-limit matrix for the signed-in caller, hydrated by the
 * `useEntitlements` query hook. Defaults mirror the server's ship state
 * (every resource unlimited), so consumers see truthful caps before the
 * first fetch lands.
 */
export const entitlementsAtom = atom<TEntitlementLimitsMatrix>({
  ...PLAN_LIMIT_DEFAULTS,
});
