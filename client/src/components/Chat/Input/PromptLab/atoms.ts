import { atom } from 'jotai';

/**
 * Feature-owned Jotai slice for the Prompt Lab. The rewrite lifecycle is
 * written and read only by this feature (entry button + panel), so it lives
 * here instead of `~/store`. `null` means the panel is closed.
 */
export type PromptLabState =
  | { status: 'loading'; original: string }
  | { status: 'error'; original: string }
  | { status: 'result'; original: string; rewrite: string };

export const promptLabAtom = atom<PromptLabState | null>(null);
