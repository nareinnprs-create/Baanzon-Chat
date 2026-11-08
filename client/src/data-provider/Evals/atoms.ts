import { atom } from 'jotai';
import type { TEvalRun } from 'librechat-data-provider';

/**
 * Eval runs hydrated by the `useEvalRuns` query hook. Empty until the first
 * fetch lands - there is no truthful server-side default to seed, unlike the
 * billing matrix.
 */
export const evalRunsAtom = atom<TEvalRun[]>([]);
