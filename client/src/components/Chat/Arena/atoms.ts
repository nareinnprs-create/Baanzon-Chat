import { atom } from 'jotai';

/** Feature-owned Arena state. Lives here — not in ~/store — so the feature
 *  stays self-contained and movable without touching global store keys. */
export const arenaOpenAtom = atom(false);
