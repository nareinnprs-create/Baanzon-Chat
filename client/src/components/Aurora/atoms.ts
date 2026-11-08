import { atom } from 'jotai';
import { useAtomValue, useSetAtom } from 'jotai';

/**
 * The Baanzon Intelligence Pulse state language (master blueprint §63.9).
 *
 * The eight states are the blueprint's own terms, verbatim: Idle, Thinking,
 * Searching, Reading, Creating, Voice, Completed, Needs attention. They form
 * the contract hosts wire their activity signals into — nothing here derives
 * or infers a state on its own, because the pulse must stay truthful
 * (§63.9: "Motion must be subtle and truthful"): a host that cannot observe an
 * activity leaves the pulse on `idle` instead of guessing.
 */
export type TAuroraPulseState =
  | 'idle'
  | 'thinking'
  | 'searching'
  | 'reading'
  | 'creating'
  | 'voice'
  | 'completed'
  | 'attention';

/** The blueprint's §63.9 states in blueprint order, written out in full. */
export const AURORA_PULSE_STATES = [
  'idle',
  'thinking',
  'searching',
  'reading',
  'creating',
  'voice',
  'completed',
  'attention',
] as const satisfies readonly TAuroraPulseState[];

/**
 * Feature-owned (client-state-ownership policy): the Aurora feature both
 * writes and reads this state, so it lives here as Jotai rather than in the
 * app-global store. `idle` is the honest default — no host has claimed an
 * activity yet. A host that wants to drive the pulse calls
 * `useSetAuroraPulse`; one that only renders the marker reads it through
 * `AuroraPulse` (or `useAuroraPulse` directly).
 */
export const auroraPulseAtom = atom<TAuroraPulseState>('idle');

/** Reads the current pulse state from the feature-owned atom. */
export function useAuroraPulse(): TAuroraPulseState {
  return useAtomValue(auroraPulseAtom);
}

/** Writes a pulse state; the setter identity is stable across renders. */
export function useSetAuroraPulse(): (state: TAuroraPulseState) => void {
  return useSetAtom(auroraPulseAtom);
}
