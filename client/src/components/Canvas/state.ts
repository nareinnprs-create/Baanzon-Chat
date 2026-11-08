import type {
  CanvasBlock,
  CanvasBlockKind,
  CanvasComment,
  CanvasDocument,
  CanvasEditOperation,
  CanvasSelection,
  CanvasVersion,
  CanvasVersionDiff,
} from './types';
import { clampIndex, clampRange, replaceRange } from '~/utils/canvas';

/**
 * Pure state machine for the Canvas workspace. No React, no Jotai and no I/O:
 * `canvasReducer` maps a state and an action to the next state. Document
 * mutations flow through a small undo/redo history; versions are immutable
 * snapshots; comments and selection are side state that never enter the history
 * stack. Invalid transitions are no-ops, so callers may dispatch optimistically.
 */

/** Maximum number of document snapshots kept on the undo stack. */
export const CANVAS_HISTORY_LIMIT = 100;

export type MoveBlockDirection = 'up' | 'down';

export type CanvasStatus = 'idle' | 'loading' | 'ready' | 'error';

export type CanvasAction =
  | { type: 'load_start' }
  | {
      type: 'load_success';
      document: CanvasDocument;
      versions?: CanvasVersion[];
      comments?: CanvasComment[];
    }
  | { type: 'load_failure'; error: string }
  | { type: 'retry' }
  | { type: 'reset' }
  | { type: 'set_title'; title: string }
  | { type: 'set_block_text'; blockId: string; text: string }
  | { type: 'insert_block'; index?: number; kind?: CanvasBlockKind; text?: string }
  | { type: 'remove_block'; blockId: string }
  | { type: 'move_block'; blockId: string; direction: MoveBlockDirection }
  | { type: 'set_selection'; selection: CanvasSelection | null }
  | { type: 'apply_operations'; operations: CanvasEditOperation[] }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'create_version'; label: string; at: string }
  | { type: 'restore_version'; versionId: string }
  | { type: 'delete_version'; versionId: string }
  | {
      type: 'add_comment';
      blockId: string;
      anchor: CanvasComment['anchor'];
      body: string;
      author: string;
      at: string;
    }
  | { type: 'resolve_comment'; commentId: string }
  | { type: 'reopen_comment'; commentId: string }
  | { type: 'delete_comment'; commentId: string };

/** One point on the undo stack: the document and selection at that moment. */
export type CanvasHistoryEntry = {
  document: CanvasDocument;
  selection: CanvasSelection | null;
};

export type CanvasState = {
  status: CanvasStatus;
  document: CanvasDocument | null;
  selection: CanvasSelection | null;
  versions: CanvasVersion[];
  comments: CanvasComment[];
  /** Undo stack, oldest first; the top is the previous document. */
  past: CanvasHistoryEntry[];
  /** Redo stack, oldest first; the top is the next document. */
  future: CanvasHistoryEntry[];
  error: string | null;
  /** True once the document changed since it was loaded or versioned. */
  dirty: boolean;
  /** Monotonic counters backing generated ids; no wall clock is read. */
  nextBlockNumber: number;
  nextVersionNumber: number;
  nextCommentNumber: number;
};

export function createInitialState(document: CanvasDocument | null = null): CanvasState {
  return {
    status: document ? 'ready' : 'idle',
    document,
    selection: null,
    versions: [],
    comments: [],
    past: [],
    future: [],
    error: null,
    dirty: false,
    nextBlockNumber: document?.blocks.length ?? 0,
    nextVersionNumber: 0,
    nextCommentNumber: 0,
  };
}

export function canUndo(state: CanvasState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: CanvasState): boolean {
  return state.future.length > 0;
}

export function selectVersion(state: CanvasState, versionId: string): CanvasVersion | null {
  return state.versions.find((version) => version.id === versionId) ?? null;
}

export function countUnresolvedComments(comments: CanvasComment[]): number {
  return comments.reduce((total, comment) => (comment.resolved ? total : total + 1), 0);
}

/**
 * Block-level diff between two documents, matched by id. `changed` counts
 * blocks present in both whose text or kind differs; title changes are not part
 * of the block diff.
 */
export function describeVersionDiff(
  base: CanvasDocument | null,
  document: CanvasDocument | null,
): CanvasVersionDiff {
  const empty: CanvasVersionDiff = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  if (!base || !document) {
    return empty;
  }
  const baseById = new Map(base.blocks.map((block) => [block.id, block]));
  const nextById = new Map(document.blocks.map((block) => [block.id, block]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;
  for (const block of document.blocks) {
    const before = baseById.get(block.id);
    if (!before) {
      added += 1;
    } else if (before.text !== block.text || before.kind !== block.kind) {
      changed += 1;
    } else {
      unchanged += 1;
    }
  }
  for (const block of base.blocks) {
    if (!nextById.has(block.id)) {
      removed += 1;
    }
  }
  return { added, removed, changed, unchanged };
}

/**
 * Applies a list of edit operations to a document, returning a new document.
 * Pure and total: unknown block ids are ignored, ranges are clamped, and the
 * input document is never mutated.
 */
export function applyOperationsToDocument(
  document: CanvasDocument,
  operations: CanvasEditOperation[],
): CanvasDocument {
  let blocks = document.blocks;
  let title = document.title;
  for (const operation of operations) {
    switch (operation.type) {
      case 'replace_selection': {
        blocks = blocks.map((block) =>
          block.id === operation.blockId
            ? {
                ...block,
                text: replaceRange(block.text, operation.start, operation.end, operation.text),
              }
            : block,
        );
        break;
      }
      case 'insert_text': {
        blocks = blocks.map((block) =>
          block.id === operation.blockId
            ? {
                ...block,
                text: replaceRange(block.text, operation.at, operation.at, operation.text),
              }
            : block,
        );
        break;
      }
      case 'replace_block': {
        blocks = blocks.map((block) =>
          block.id === operation.blockId ? { ...block, text: operation.text } : block,
        );
        break;
      }
      case 'set_block_kind': {
        blocks = blocks.map((block) =>
          block.id === operation.blockId ? { ...block, kind: operation.kind } : block,
        );
        break;
      }
      case 'insert_block': {
        const index = clampIndex(operation.index, blocks.length);
        blocks = [...blocks.slice(0, index), operation.block, ...blocks.slice(index)];
        break;
      }
      case 'remove_block': {
        blocks = blocks.filter((block) => block.id !== operation.blockId);
        break;
      }
      case 'set_title': {
        title = operation.title;
        break;
      }
      default:
        break;
    }
  }
  return { ...document, title, blocks };
}

/**
 * Records the current document on the undo stack and installs `next`. The
 * redo stack is cleared, matching the usual editing contract. When no document
 * exists yet (the first block creates one) there is nothing to undo.
 */
function commit(
  state: CanvasState,
  next: CanvasDocument,
  patch: Partial<CanvasState> = {},
): CanvasState {
  const past =
    state.document == null
      ? state.past
      : [...state.past, { document: state.document, selection: state.selection }].slice(
          -CANVAS_HISTORY_LIMIT,
        );
  return { ...state, ...patch, document: next, past, future: [], dirty: true };
}

function replaceBlockText(document: CanvasDocument, blockId: string, text: string): CanvasDocument {
  return {
    ...document,
    blocks: document.blocks.map((block) => (block.id === blockId ? { ...block, text } : block)),
  };
}

export function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case 'load_start': {
      return { ...state, status: 'loading', error: null };
    }

    case 'load_success': {
      if (state.status === 'ready' && state.document === action.document) {
        return state;
      }
      return {
        status: 'ready',
        document: action.document,
        selection: null,
        versions: action.versions ?? [],
        comments: action.comments ?? [],
        past: [],
        future: [],
        error: null,
        dirty: false,
        nextBlockNumber: action.document.blocks.length,
        nextVersionNumber: (action.versions ?? []).length,
        nextCommentNumber: (action.comments ?? []).length,
      };
    }

    case 'load_failure': {
      return { ...state, status: 'error', error: action.error };
    }

    case 'retry': {
      if (state.status !== 'error') {
        return state;
      }
      return { ...state, status: 'loading', error: null };
    }

    case 'reset': {
      return createInitialState();
    }

    case 'set_title': {
      if (!state.document || state.document.title === action.title) {
        return state;
      }
      return commit(state, { ...state.document, title: action.title });
    }

    case 'set_block_text': {
      if (!state.document) {
        return state;
      }
      const target = state.document.blocks.find((block) => block.id === action.blockId);
      if (!target || target.text === action.text) {
        return state;
      }
      return commit(state, replaceBlockText(state.document, action.blockId, action.text));
    }

    case 'insert_block': {
      const document = state.document ?? {
        id: 'document-1',
        title: '',
        blocks: [] as CanvasBlock[],
      };
      const index = clampIndex(action.index ?? document.blocks.length, document.blocks.length);
      const block: CanvasBlock = {
        id: `block-${state.nextBlockNumber + 1}`,
        kind: action.kind ?? 'paragraph',
        text: action.text ?? '',
      };
      const next: CanvasDocument = {
        ...document,
        blocks: [...document.blocks.slice(0, index), block, ...document.blocks.slice(index)],
      };
      return commit(state, next, {
        status: 'ready',
        nextBlockNumber: state.nextBlockNumber + 1,
      });
    }

    case 'remove_block': {
      if (!state.document) {
        return state;
      }
      const blocks = state.document.blocks.filter((block) => block.id !== action.blockId);
      if (blocks.length === state.document.blocks.length) {
        return state;
      }
      const selection = state.selection?.blockId === action.blockId ? null : state.selection;
      return commit(state, { ...state.document, blocks }, { selection });
    }

    case 'move_block': {
      if (!state.document) {
        return state;
      }
      const index = state.document.blocks.findIndex((block) => block.id === action.blockId);
      if (index === -1) {
        return state;
      }
      const target = action.direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= state.document.blocks.length) {
        return state;
      }
      const blocks = [...state.document.blocks];
      [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
      return commit(state, { ...state.document, blocks });
    }

    case 'set_selection': {
      const incoming = action.selection;
      if (!incoming) {
        return state.selection == null ? state : { ...state, selection: null };
      }
      const block = state.document?.blocks.find((candidate) => candidate.id === incoming.blockId);
      if (!block) {
        return { ...state, selection: null };
      }
      const bounded = clampRange(incoming.start, incoming.end, block.text.length);
      const text = block.text.slice(bounded.start, bounded.end);
      if (text.length === 0) {
        return { ...state, selection: null };
      }
      return {
        ...state,
        selection: { blockId: block.id, start: bounded.start, end: bounded.end, text },
      };
    }

    case 'apply_operations': {
      if (!state.document || action.operations.length === 0) {
        return state;
      }
      const next = applyOperationsToDocument(state.document, action.operations);
      return commit(state, next, { selection: null });
    }

    case 'undo': {
      if (!state.document || state.past.length === 0) {
        return state;
      }
      const entry = state.past[state.past.length - 1];
      const future = [
        ...state.future,
        { document: state.document, selection: state.selection },
      ].slice(-CANVAS_HISTORY_LIMIT);
      return {
        ...state,
        document: entry.document,
        selection: entry.selection,
        past: state.past.slice(0, -1),
        future,
        dirty: true,
      };
    }

    case 'redo': {
      if (!state.document || state.future.length === 0) {
        return state;
      }
      const entry = state.future[state.future.length - 1];
      const past = [...state.past, { document: state.document, selection: state.selection }].slice(
        -CANVAS_HISTORY_LIMIT,
      );
      return {
        ...state,
        document: entry.document,
        selection: entry.selection,
        past,
        future: state.future.slice(0, -1),
        dirty: true,
      };
    }

    case 'create_version': {
      if (!state.document) {
        return state;
      }
      const version: CanvasVersion = {
        id: `version-${state.nextVersionNumber + 1}`,
        label: action.label,
        createdAt: action.at,
        document: state.document,
      };
      return {
        ...state,
        versions: [...state.versions, version],
        nextVersionNumber: state.nextVersionNumber + 1,
        dirty: false,
      };
    }

    case 'restore_version': {
      const version = state.versions.find((candidate) => candidate.id === action.versionId);
      if (!version) {
        return state;
      }
      return commit(state, version.document, { selection: null });
    }

    case 'delete_version': {
      const versions = state.versions.filter((version) => version.id !== action.versionId);
      if (versions.length === state.versions.length) {
        return state;
      }
      return { ...state, versions };
    }

    case 'add_comment': {
      const body = action.body.trim();
      if (!state.document || body.length === 0) {
        return state;
      }
      const comment: CanvasComment = {
        id: `comment-${state.nextCommentNumber + 1}`,
        blockId: action.blockId,
        anchor: action.anchor,
        body,
        author: action.author,
        createdAt: action.at,
        resolved: false,
      };
      return {
        ...state,
        comments: [...state.comments, comment],
        nextCommentNumber: state.nextCommentNumber + 1,
      };
    }

    case 'resolve_comment': {
      return setCommentResolved(state, action.commentId, true);
    }

    case 'reopen_comment': {
      return setCommentResolved(state, action.commentId, false);
    }

    case 'delete_comment': {
      const comments = state.comments.filter((comment) => comment.id !== action.commentId);
      if (comments.length === state.comments.length) {
        return state;
      }
      return { ...state, comments };
    }

    default:
      return state;
  }
}

function setCommentResolved(state: CanvasState, commentId: string, resolved: boolean): CanvasState {
  const target = state.comments.find((comment) => comment.id === commentId);
  if (!target || target.resolved === resolved) {
    return state;
  }
  return {
    ...state,
    comments: state.comments.map((comment) =>
      comment.id === commentId ? { ...comment, resolved } : comment,
    ),
  };
}
