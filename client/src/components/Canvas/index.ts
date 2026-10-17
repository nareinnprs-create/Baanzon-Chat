/**
 * Canvas workspace — a self-contained client feature: a resizable document
 * editor with inline AI edits, anchored comments and version history.
 *
 * Everything the feature needs lives in this folder. It owns its state in
 * Jotai atoms (`./atoms`) and never reaches into `~/store`, Recoil, a
 * data-provider endpoint or the router. The only seams to a backend are the
 * injected `loadDocument` and `editSelection` functions.
 *
 * ## Mounting
 *
 * ```tsx
 * import { Provider as JotaiProvider, createStore } from 'jotai';
 * import {
 *   CanvasWorkspace,
 *   createInMemoryEditSelection,
 *   createSampleDocument,
 * } from '~/components/Canvas';
 *
 * // A real integration passes its own `editSelection` (and, for remote
 * // documents, its own `loadDocument`); the in-memory pair is a working
 * // default and what the tests use.
 * const editSelection = createInMemoryEditSelection();
 *
 * export function CanvasPage() {
 *   return (
 *     <JotaiProvider store={createStore()}>
 *       <CanvasWorkspace
 *         document={createSampleDocument()}
 *         editSelection={editSelection}
 *       />
 *     </JotaiProvider>
 *   );
 * }
 * ```
 *
 * Mount it under a fresh Jotai `Provider` when you want isolated state per
 * mount (recommended in tests and for multiple concurrent instances); without
 * one it uses Jotai's default store. User-facing copy currently comes from
 * `./labels`; see the TODO(i18n) there.
 */

export { default as CanvasWorkspace } from './CanvasWorkspace';
export { default as CanvasEditor } from './CanvasEditor';
export { default as SplitView } from './SplitView';
export { default as CommentsPanel } from './CommentsPanel';
export { default as VersionHistory } from './VersionHistory';
export {
  applyInstructionToSelection,
  createInMemoryEditSelection,
  createSampleDocument,
} from './api';
export {
  applyOperationsToDocument,
  canRedo,
  canUndo,
  canvasReducer,
  countUnresolvedComments,
  createInitialState,
  describeVersionDiff,
  selectVersion,
} from './state';
export { CANVAS_LABELS, formatCanvasLabel } from './labels';
export type { CanvasLabelKey } from './labels';
export type { CanvasWorkspaceProps } from './CanvasWorkspace';
export type { CanvasEditorProps } from './CanvasEditor';
export type { SplitViewProps } from './SplitView';
export type { CommentsPanelProps } from './CommentsPanel';
export type { VersionHistoryProps } from './VersionHistory';
export type { EditSelectionFn, EditSelectionResult, InMemoryEditSelectionOptions } from './api';
export type { CanvasAction, CanvasState, CanvasStatus, MoveBlockDirection } from './state';
export type {
  CanvasAnchor,
  CanvasBlock,
  CanvasBlockKind,
  CanvasComment,
  CanvasDocument,
  CanvasEditOperation,
  CanvasSelection,
  CanvasVersion,
  CanvasVersionDiff,
} from './types';
