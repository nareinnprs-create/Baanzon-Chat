import { atom } from 'jotai';

/**
 * Feature-owned Jotai slice for the skill-tree workspace. Selection and folder
 * expansion are written and read only by the tree feature, so they stay here
 * rather than in `~/store`. No root Provider is installed, so the workspace
 * resets both atoms whenever the active skill changes.
 */
export const skillTreeSelectedNodeAtom = atom<string | null>(null);

export const skillTreeExpandedFoldersAtom = atom<Set<string>>(new Set<string>());
