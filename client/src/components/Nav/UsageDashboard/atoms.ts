import { atom } from 'jotai';
import type { UsageScope } from './aggregate';

/** Feature-owned: which aggregate the usage dashboard displays. */
export const usageScopeAtom = atom<UsageScope>('current');
