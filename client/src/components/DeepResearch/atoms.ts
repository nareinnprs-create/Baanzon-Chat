import { atom } from 'jotai';
import type { ResearchEvent, ResearchPlan, ResearchStatus } from './types';
import type { DeepResearchAction, DeepResearchState } from './state';
import { createInitialState, deepResearchReducer } from './state';

/**
 * Feature-owned Jotai state for the Deep Research flow.
 *
 * A feature that both writes and reads the state owns it, so it lives here and
 * never in `~/store` or Recoil. {@link deepResearchStateAtom} is the source of
 * truth; the narrower atoms are read-only lenses over it so consumers subscribe
 * to exactly what they render. Mount the view under a fresh
 * `<Provider store={createStore()}>` when you want isolated state per mount.
 */

/** The complete reducer state: plan, status, report, error and event log. */
export const deepResearchStateAtom = atom<DeepResearchState>(createInitialState());

/** The editable plan, or `null` before one has been generated. */
export const deepResearchPlanAtom = atom<ResearchPlan | null>(
  (get) => get(deepResearchStateAtom).plan,
);

/** The lifecycle status of the flow. */
export const deepResearchStatusAtom = atom<ResearchStatus>(
  (get) => get(deepResearchStateAtom).status,
);

/** The append-only event log, newest last. */
export const deepResearchEventsAtom = atom<ResearchEvent[]>(
  (get) => get(deepResearchStateAtom).events,
);

/**
 * Write-only dispatcher. `dispatchAtom(action)` feeds the action through the
 * pure reducer, so components never set the state atom directly.
 */
export const dispatchDeepResearchAtom = atom(null, (get, set, action: DeepResearchAction) => {
  set(deepResearchStateAtom, deepResearchReducer(get(deepResearchStateAtom), action));
});
