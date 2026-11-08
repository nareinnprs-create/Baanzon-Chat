import type {
  CanvasBlock,
  CanvasComment,
  CanvasDocument,
  CanvasEditOperation,
  CanvasVersion,
} from '../types';
import type { CanvasAction, CanvasState } from '../state';
import {
  applyOperationsToDocument,
  canRedo,
  canUndo,
  canvasReducer,
  countUnresolvedComments,
  createInitialState,
  describeVersionDiff,
  selectVersion,
} from '../state';
import { applyInstructionToSelection } from '../api';

function makeBlock(id: string, text = id): CanvasBlock {
  return { id, kind: 'paragraph', text };
}

function makeDocument(blocks: CanvasBlock[] = []): CanvasDocument {
  return { id: 'document-1', title: 'Doc', blocks };
}

function makeComment(id: string, resolved = false): CanvasComment {
  return {
    id,
    blockId: 'block-1',
    anchor: { start: 0, end: 1, text: 'a' },
    body: `comment ${id}`,
    author: 'You',
    createdAt: '2026-01-01T00:00:00.000Z',
    resolved,
  };
}

function makeVersion(id: string, document: CanvasDocument): CanvasVersion {
  return { id, label: id, createdAt: '2026-01-01T00:00:00.000Z', document };
}

/** Reduces a list of actions over an initial state; the common test shorthand. */
function run(actions: CanvasAction[], initial: CanvasState = createInitialState()) {
  return actions.reduce(canvasReducer, initial);
}

function loaded(blocks: CanvasBlock[] = [makeBlock('block-1', 'Hello')]): CanvasState {
  return run([{ type: 'load_success', document: makeDocument(blocks) }]);
}

describe('createInitialState', () => {
  it('starts idle and empty when no document is supplied', () => {
    const state = createInitialState();
    expect(state.status).toBe('idle');
    expect(state.document).toBeNull();
    expect(state.selection).toBeNull();
    expect(state.versions).toEqual([]);
    expect(state.comments).toEqual([]);
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(false);
  });

  it('starts ready when a document is supplied', () => {
    const state = createInitialState(makeDocument([makeBlock('block-1')]));
    expect(state.status).toBe('ready');
    expect(state.nextBlockNumber).toBe(1);
  });
});

describe('canvasReducer loading', () => {
  it('walks loading -> ready -> error -> retry', () => {
    let state = canvasReducer(createInitialState(), { type: 'load_start' });
    expect(state.status).toBe('loading');

    state = canvasReducer(state, {
      type: 'load_success',
      document: makeDocument([makeBlock('block-1')]),
      versions: [makeVersion('version-1', makeDocument())],
      comments: [makeComment('comment-1')],
    });
    expect(state.status).toBe('ready');
    expect(state.versions).toHaveLength(1);
    expect(state.comments).toHaveLength(1);
    expect(state.nextVersionNumber).toBe(1);
    expect(state.nextCommentNumber).toBe(1);

    state = canvasReducer(state, { type: 'load_failure', error: 'Boom' });
    expect(state.status).toBe('error');
    expect(state.error).toBe('Boom');

    state = canvasReducer(state, { type: 'retry' });
    expect(state.status).toBe('loading');
    expect(state.error).toBeNull();
  });
});

describe('canvasReducer editing and history', () => {
  it('lazily creates a document on the first insert_block', () => {
    const state = canvasReducer(createInitialState(), { type: 'insert_block', text: 'First' });
    expect(state.document?.blocks).toHaveLength(1);
    expect(state.document?.blocks[0].id).toBe('block-1');
    expect(state.status).toBe('ready');
  });

  it('inserts blocks at an index and generates monotonic ids', () => {
    let state = loaded([makeBlock('block-1'), makeBlock('block-2')]);
    state = canvasReducer(state, { type: 'insert_block', index: 1, text: 'New' });
    expect(state.document?.blocks.map((block) => block.id)).toEqual([
      'block-1',
      'block-3',
      'block-2',
    ]);
  });

  it('updates block text and the title', () => {
    let state = loaded([makeBlock('block-1', 'Hello')]);
    state = canvasReducer(state, { type: 'set_block_text', blockId: 'block-1', text: 'Bye' });
    state = canvasReducer(state, { type: 'set_title', title: 'Renamed' });
    expect(state.document?.blocks[0].text).toBe('Bye');
    expect(state.document?.title).toBe('Renamed');
    expect(state.dirty).toBe(true);
  });

  it('undoes and redoes edits in order', () => {
    let state = loaded([makeBlock('block-1', 'a')]);
    state = canvasReducer(state, { type: 'set_block_text', blockId: 'block-1', text: 'b' });
    state = canvasReducer(state, { type: 'set_block_text', blockId: 'block-1', text: 'c' });
    expect(canUndo(state)).toBe(true);

    state = canvasReducer(state, { type: 'undo' });
    expect(state.document?.blocks[0].text).toBe('b');
    state = canvasReducer(state, { type: 'undo' });
    expect(state.document?.blocks[0].text).toBe('a');
    expect(canUndo(state)).toBe(false);

    state = canvasReducer(state, { type: 'redo' });
    expect(state.document?.blocks[0].text).toBe('b');
    state = canvasReducer(state, { type: 'redo' });
    expect(state.document?.blocks[0].text).toBe('c');
    expect(canRedo(state)).toBe(false);
  });

  it('clears the redo stack once a new edit lands', () => {
    let state = loaded([makeBlock('block-1', 'a')]);
    state = canvasReducer(state, { type: 'set_block_text', blockId: 'block-1', text: 'b' });
    state = canvasReducer(state, { type: 'undo' });
    expect(canRedo(state)).toBe(true);
    state = canvasReducer(state, { type: 'set_block_text', blockId: 'block-1', text: 'z' });
    expect(canRedo(state)).toBe(false);
  });

  it('applies AI operations and clears the selection', () => {
    let state = loaded([makeBlock('block-1', 'Hello world')]);
    state = canvasReducer(state, {
      type: 'set_selection',
      selection: { blockId: 'block-1', start: 0, end: 5, text: 'Hello' },
    });
    const operations: CanvasEditOperation[] = [
      { type: 'replace_selection', blockId: 'block-1', start: 0, end: 5, text: 'Goodbye' },
    ];
    state = canvasReducer(state, { type: 'apply_operations', operations });
    expect(state.document?.blocks[0].text).toBe('Goodbye world');
    expect(state.selection).toBeNull();
  });

  it('ignores operations when there is no document', () => {
    const state = createInitialState();
    const next = canvasReducer(state, {
      type: 'apply_operations',
      operations: [{ type: 'set_title', title: 'x' }],
    });
    expect(next).toBe(state);
  });
});

describe('canvasReducer versions', () => {
  it('snapshots the document, then restores it as a tracked edit', () => {
    let state = loaded([makeBlock('block-1', 'v1')]);
    state = canvasReducer(state, {
      type: 'create_version',
      label: 'First',
      at: '2026-01-01T00:00:00.000Z',
    });
    expect(state.versions).toHaveLength(1);
    expect(state.versions[0].id).toBe('version-1');
    expect(state.dirty).toBe(false);
    expect(canUndo(state)).toBe(false);

    state = canvasReducer(state, { type: 'set_block_text', blockId: 'block-1', text: 'v2' });
    expect(state.document?.blocks[0].text).toBe('v2');

    state = canvasReducer(state, { type: 'restore_version', versionId: 'version-1' });
    expect(state.document?.blocks[0].text).toBe('v1');
    expect(canUndo(state)).toBe(true);

    state = canvasReducer(state, { type: 'undo' });
    expect(state.document?.blocks[0].text).toBe('v2');
  });

  it('ignores restoring an unknown version and deletes a known one', () => {
    let state = run([
      { type: 'load_success', document: makeDocument([makeBlock('block-1')]) },
      { type: 'create_version', label: 'First', at: '2026-01-01T00:00:00.000Z' },
    ]);
    const before = canvasReducer(state, { type: 'restore_version', versionId: 'missing' });
    expect(before).toBe(state);

    state = canvasReducer(state, { type: 'delete_version', versionId: 'version-1' });
    expect(state.versions).toHaveLength(0);
    expect(selectVersion(state, 'version-1')).toBeNull();
  });
});

describe('canvasReducer comments', () => {
  it('adds, resolves, reopens and deletes comments', () => {
    let state = loaded();
    state = canvasReducer(state, {
      type: 'add_comment',
      blockId: 'block-1',
      anchor: { start: 0, end: 5, text: 'Hello' },
      body: '  Please reword  ',
      author: 'You',
      at: '2026-01-01T00:00:00.000Z',
    });
    expect(state.comments).toHaveLength(1);
    expect(state.comments[0].body).toBe('Please reword');
    expect(state.comments[0].resolved).toBe(false);
    expect(countUnresolvedComments(state.comments)).toBe(1);

    state = canvasReducer(state, { type: 'resolve_comment', commentId: 'comment-1' });
    expect(state.comments[0].resolved).toBe(true);
    expect(countUnresolvedComments(state.comments)).toBe(0);

    state = canvasReducer(state, { type: 'reopen_comment', commentId: 'comment-1' });
    expect(state.comments[0].resolved).toBe(false);

    state = canvasReducer(state, { type: 'delete_comment', commentId: 'comment-1' });
    expect(state.comments).toHaveLength(0);
  });

  it('rejects an empty comment body', () => {
    const state = loaded();
    const next = canvasReducer(state, {
      type: 'add_comment',
      blockId: 'block-1',
      anchor: null,
      body: '   ',
      author: 'You',
      at: '2026-01-01T00:00:00.000Z',
    });
    expect(next).toBe(state);
  });
});

describe('canvasReducer selection validation', () => {
  it('rejects a selection for an unknown block', () => {
    const state = loaded([makeBlock('block-1', 'Hello')]);
    const next = canvasReducer(state, {
      type: 'set_selection',
      selection: { blockId: 'missing', start: 0, end: 1, text: 'x' },
    });
    expect(next.selection).toBeNull();
  });

  it('clamps an out-of-range selection to the block text', () => {
    const state = loaded([makeBlock('block-1', 'Hello')]);
    const next = canvasReducer(state, {
      type: 'set_selection',
      selection: { blockId: 'block-1', start: 3, end: 99, text: 'anything' },
    });
    expect(next.selection).toEqual({ blockId: 'block-1', start: 3, end: 5, text: 'lo' });
  });

  it('clears the selection when the range collapses to empty text', () => {
    const state = loaded([makeBlock('block-1', 'Hello')]);
    const next = canvasReducer(state, {
      type: 'set_selection',
      selection: { blockId: 'block-1', start: 2, end: 2, text: '' },
    });
    expect(next.selection).toBeNull();
  });
});

describe('canvasReducer block structure', () => {
  it('moves a block up and down and refuses moves past the bounds', () => {
    let state = loaded([makeBlock('block-1', 'a'), makeBlock('block-2', 'b')]);
    state = canvasReducer(state, { type: 'move_block', blockId: 'block-2', direction: 'up' });
    expect(state.document?.blocks.map((block) => block.id)).toEqual(['block-2', 'block-1']);

    const aboveTop = canvasReducer(state, {
      type: 'move_block',
      blockId: 'block-2',
      direction: 'up',
    });
    expect(aboveTop).toBe(state);

    state = canvasReducer(state, { type: 'move_block', blockId: 'block-2', direction: 'down' });
    expect(state.document?.blocks.map((block) => block.id)).toEqual(['block-1', 'block-2']);

    const unknown = canvasReducer(state, {
      type: 'move_block',
      blockId: 'missing',
      direction: 'up',
    });
    expect(unknown).toBe(state);
  });

  it('removes a block, clears a selection anchored to it, and ignores unknown ids', () => {
    let state = loaded([makeBlock('block-1', 'Hello'), makeBlock('block-2', 'World')]);
    state = canvasReducer(state, {
      type: 'set_selection',
      selection: { blockId: 'block-1', start: 0, end: 5, text: 'Hello' },
    });
    state = canvasReducer(state, { type: 'remove_block', blockId: 'block-1' });
    expect(state.document?.blocks.map((block) => block.id)).toEqual(['block-2']);
    expect(state.selection).toBeNull();

    const unchanged = canvasReducer(state, { type: 'remove_block', blockId: 'missing' });
    expect(unchanged).toBe(state);
  });
});

describe('applyOperationsToDocument', () => {
  it('clamps replace ranges and leaves the input untouched', () => {
    const document = makeDocument([makeBlock('block-1', 'Hello')]);
    const next = applyOperationsToDocument(document, [
      { type: 'replace_selection', blockId: 'block-1', start: 3, end: 999, text: 'p!' },
    ]);
    expect(next.blocks[0].text).toBe('Help!');
    expect(document.blocks[0].text).toBe('Hello');
  });

  it('inserts and removes blocks by id', () => {
    const document = makeDocument([makeBlock('block-1'), makeBlock('block-2')]);
    const next = applyOperationsToDocument(document, [
      { type: 'insert_block', index: 1, block: makeBlock('block-9', 'Inserted') },
      { type: 'remove_block', blockId: 'block-1' },
    ]);
    expect(next.blocks.map((block) => block.id)).toEqual(['block-9', 'block-2']);
  });
});

describe('describeVersionDiff', () => {
  it('counts added, removed and changed blocks', () => {
    const base = makeDocument([
      makeBlock('block-1', 'same'),
      makeBlock('block-2', 'before'),
      makeBlock('block-3', 'gone'),
    ]);
    const document = makeDocument([
      makeBlock('block-1', 'same'),
      makeBlock('block-2', 'after'),
      makeBlock('block-4', 'new'),
    ]);
    expect(describeVersionDiff(base, document)).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
      unchanged: 1,
    });
  });

  it('returns an empty diff when either side is missing', () => {
    expect(describeVersionDiff(null, makeDocument())).toEqual({
      added: 0,
      removed: 0,
      changed: 0,
      unchanged: 0,
    });
  });
});

describe('applyInstructionToSelection', () => {
  it('rewrites a recognised instruction and appends an unrecognised one', () => {
    const selection = { blockId: 'block-1', start: 0, end: 2, text: 'hi' };
    expect(applyInstructionToSelection(selection, 'uppercase')).toEqual([
      { type: 'replace_selection', blockId: 'block-1', start: 0, end: 2, text: 'HI' },
    ]);
    expect(applyInstructionToSelection(selection, 'polish')[0]).toMatchObject({
      text: 'hi (polish)',
    });
    expect(applyInstructionToSelection(selection, '   ')).toEqual([]);
  });
});
