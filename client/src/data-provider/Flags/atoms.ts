import { atom } from 'jotai';
import { FEATURE_FLAG_DEFAULTS } from 'librechat-data-provider';
import type { TFeatureFlagMap } from 'librechat-data-provider';

/**
 * Resolved feature-flag state for the signed-in caller, hydrated by the
 * `useFeatureFlags` query hook. Defaults mirror the server's ship state, so
 * consumers render correctly before the first fetch lands.
 */
export const featureFlagsAtom = atom<TFeatureFlagMap>({
  ...FEATURE_FLAG_DEFAULTS,
});
