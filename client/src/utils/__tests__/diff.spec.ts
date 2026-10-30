import { collapseDiff, diffLines } from '../diff';

describe('diffLines', () => {
  it('marks added, removed and unchanged lines', () => {
    const rows = diffLines('a\nb\nc', 'a\nX\nc\nd');
    expect(rows).toEqual([
      { type: 'same', text: 'a' },
      { type: 'remove', text: 'b' },
      { type: 'add', text: 'X' },
      { type: 'same', text: 'c' },
      { type: 'add', text: 'd' },
    ]);
  });

  it('treats empty previous as all additions', () => {
    expect(diffLines(undefined, 'one\ntwo')).toEqual([
      { type: 'add', text: 'one' },
      { type: 'add', text: 'two' },
    ]);
  });

  it('treats empty current as all removals', () => {
    expect(diffLines('one', undefined)).toEqual([{ type: 'remove', text: 'one' }]);
  });

  it('ignores a trailing newline difference', () => {
    expect(diffLines('a\n', 'a')).toEqual([{ type: 'same', text: 'a' }]);
  });
});

describe('collapseDiff', () => {
  const rows = diffLines(
    Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n'),
    ['line0', 'CHANGED', ...Array.from({ length: 28 }, (_, i) => `line${i + 1}`)].join('\n'),
  );

  it('keeps pad lines around changes and collapses the rest into gaps', () => {
    const collapsed = collapseDiff(rows, 2);
    const gaps = collapsed.filter((row) => row.collapsedGap != null);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.reduce((sum, gap) => sum + (gap.collapsedGap ?? 0), 0)).toBeGreaterThan(15);
    // Changed line survives.
    expect(collapsed.some((row) => row.text === 'CHANGED')).toBe(true);
  });
});
