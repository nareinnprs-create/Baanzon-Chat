import { atom } from 'jotai';

/**
 * Open/close state for the in-conversation find bar. The bar both writes it
 * (`⌘/Ctrl+F`, Escape, the close button) and reads it, so it is feature-owned
 * Jotai state.
 */
export const inConversationFindOpenAtom = atom(false);

/**
 * The current search string. It lives beside the open flag rather than in
 * component state because a closed bar still owns the last query: the tests seed
 * it to exercise the first-scan loading state, and it is cleared explicitly on
 * Escape/close so reopening always starts clean.
 */
export const inConversationFindQueryAtom = atom('');
