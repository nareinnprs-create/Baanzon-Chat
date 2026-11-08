import { atom } from 'jotai';
import type { CanvasComment, CanvasDocument, CanvasSelection, CanvasVersion } from './types';
import type { CanvasAction, CanvasState, CanvasStatus } from './state';
import { canRedo, canUndo, canvasReducer, createInitialState } from './state';

/**
 * Feature-owned Jotai state for the Canvas workspace.
 *
 * A feature that both writes and reads the state owns it, so it lives here and
 * never in `~/store` or Recoil. {@link canvasStateAtom} is the source of truth;
 * the narrower atoms are read-only lenses over it so consumers subscribe to
 * exactly what they render. Mount the workspace under a fresh
 * `<Provider store={createStore()}>` when you want isolated state per mount.
 */

/** The complete reducer state: document, history, versions, comments, error. */
export const canvasStateAtom = atom<CanvasState>(createInitialState());

/** The editable document, or `null` before one is loaded or created. */
export const canvasDocumentAtom = atom<CanvasDocument | null>(
  (get) => get(canvasStateAtom).document,
);

/** The current selection captured in the editor, or `null`. */
export const canvasSelectionAtom = atom<CanvasSelection | null>(
  (get) => get(canvasStateAtom).selection,
);

/** The saved version snapshots, oldest first. */
export const canvasVersionsAtom = atom<CanvasVersion[]>((get) => get(canvasStateAtom).versions);

/** The review comments, oldest first. */
export const canvasCommentsAtom = atom<CanvasComment[]>((get) => get(canvasStateAtom).comments);

/** The lifecycle status of the load. */
export const canvasStatusAtom = atom<CanvasStatus>((get) => get(canvasStateAtom).status);

/** The load failure message, or `null`. */
export const canvasErrorAtom = atom<string | null>((get) => get(canvasStateAtom).error);

/** Whether the undo stack has an entry. */
export const canvasCanUndoAtom = atom<boolean>((get) => canUndo(get(canvasStateAtom)));

/** Whether the redo stack has an entry. */
export const canvasCanRedoAtom = atom<boolean>((get) => canRedo(get(canvasStateAtom)));

/**
 * Write-only dispatcher. `dispatchCanvasAtom(action)` feeds the action through
 * the pure reducer, so components never set the state atom directly.
 */
export const dispatchCanvasAtom = atom(null, (get, set, action: CanvasAction) => {
  set(canvasStateAtom, canvasReducer(get(canvasStateAtom), action));
});
