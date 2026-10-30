/**
 * Minimal LCS-based line diff for artifact version comparison (X9). No
 * dependency: artifacts are code-sized, O(n*m) is fine at these lengths.
 */

export interface DiffRow {
  type: 'same' | 'add' | 'remove';
  text: string;
}

/** Split on newlines, keeping a trailing empty line out of the comparison. */
function toLines(text: string | undefined): string[] {
  if (text == null || text === '') {
    return [];
  }
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

export function diffLines(
  previous: string | undefined,
  current: string | undefined,
): DiffRow[] {
  const a = toLines(previous);
  const b = toLines(current);
  const n = a.length;
  const m = b.length;

  // LCS table
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      rows.push({ type: 'remove', text: a[i] });
      i++;
    } else {
      rows.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) {
    rows.push({ type: 'remove', text: a[i] });
    i++;
  }
  while (j < m) {
    rows.push({ type: 'add', text: b[j] });
    j++;
  }
  return rows;
}

/** Collapse long runs of unchanged lines: keep `pad` lines around changes. */
export function collapseDiff(rows: DiffRow[], pad = 3): (DiffRow & { collapsedGap?: number })[] {
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, index) => {
    if (row.type !== 'same') {
      for (let k = Math.max(0, index - pad); k <= Math.min(rows.length - 1, index + pad); k++) {
        keep[k] = true;
      }
    }
  });
  const out: (DiffRow & { collapsedGap?: number })[] = [];
  let gap = 0;
  rows.forEach((row, index) => {
    if (keep[index]) {
      if (gap > 0) {
        out.push({ type: 'same', text: '', collapsedGap: gap });
        gap = 0;
      }
      out.push(row);
    } else {
      gap++;
    }
  });
  if (gap > 0) {
    out.push({ type: 'same', text: '', collapsedGap: gap });
  }
  return out;
}
