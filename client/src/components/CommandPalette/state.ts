import { atom } from 'jotai';

/**
 * Open/close state for the command palette. The palette both writes it (⌘K,
 * Escape, item activation) and reads it, so it is feature-owned Jotai state.
 */
export const commandPaletteOpenAtom = atom(false);
