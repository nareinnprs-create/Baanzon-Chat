import type { CanvasSnapshot } from '../storage';
import { loadCanvasSnapshot, saveCanvasSnapshot } from '../storage';

const KEY = 'canvas-test';

function snapshot(): CanvasSnapshot {
  return {
    document: {
      id: 'document-1',
      title: 'Doc',
      blocks: [{ id: 'block-1', kind: 'paragraph', text: 'Hello' }],
    },
    comments: [
      {
        id: 'comment-1',
        blockId: 'block-1',
        anchor: null,
        body: 'Note',
        author: 'You',
        createdAt: '2026-01-01T00:00:00.000Z',
        resolved: false,
      },
    ],
    versions: [],
  };
}

describe('canvas storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a snapshot', () => {
    saveCanvasSnapshot(KEY, snapshot());
    expect(loadCanvasSnapshot(KEY)).toEqual(snapshot());
  });

  it('returns null when nothing is stored', () => {
    expect(loadCanvasSnapshot(KEY)).toBeNull();
  });

  it('ignores unparseable or foreign data instead of throwing', () => {
    localStorage.setItem(KEY, 'not json');
    expect(loadCanvasSnapshot(KEY)).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ version: 99, document: {} }));
    expect(loadCanvasSnapshot(KEY)).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ version: 1, document: { id: 'x' } }));
    expect(loadCanvasSnapshot(KEY)).toBeNull();
  });

  it('drops malformed comments and versions but keeps the document', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        document: snapshot().document,
        comments: [{ id: 'broken' }, snapshot().comments[0]],
        versions: [{ id: 'nope' }],
      }),
    );
    const loaded = loadCanvasSnapshot(KEY);
    expect(loaded?.comments).toHaveLength(1);
    expect(loaded?.versions).toEqual([]);
  });

  it('survives a storage that refuses writes', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveCanvasSnapshot(KEY, snapshot())).not.toThrow();
    setItem.mockRestore();
  });
});
