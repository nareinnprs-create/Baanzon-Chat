import { atom } from 'jotai';
import type { ModelLane } from 'librechat-data-provider';

/** Per-turn chat lane selection; null preserves the existing model behavior. */
export const selectedModelLaneAtom = atom<ModelLane | null>(null);
