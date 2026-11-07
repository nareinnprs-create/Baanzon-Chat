import { atom } from 'jotai';
import type { OfflineSendItem } from './queue';

/**
 * Feature-owned Jotai slice for the offline queue. Both atoms are written and
 * read by the offline feature only, so they stay here rather than in `~/store`.
 */
export const offlinePendingSendsAtom = atom<OfflineSendItem[]>([]);

/** Mirrors `navigator.onLine`; starts optimistic so SSR/first paint does not read as offline. */
export const offlineOnlineAtom = atom<boolean>(true);
