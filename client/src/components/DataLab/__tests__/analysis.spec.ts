import type { DataTable } from '../types';
import {
  aggregateByCategory,
  applyFilters,
  deriveValues,
  describeTable,
  formatCell,
  getNumericColumns,
  pickXColumn,
  sortRows,
} from '../analysis';

const table: DataTable = {
  columns: [
    { key: 'name', label: 'Name', type: 'string' },
    { key: 'score', label: 'Score', type: 'number' },
    { key: 'joined', label: 'Joined', type: 'date' },
  ],
  rows: [
    { name: 'b', score: 2, joined: '2020-02-01' },
    { name: 'a', score: 10, joined: '2020-01-01' },
    { name: 'c', score: 1, joined: '2021-06-01' },
  ],
};

describe('describeTable', () => {
  it('summarizes counts and numeric statistics per column', () => {
    const stats = describeTable(table);
    const name = stats.find((stat) => stat.key === 'name');
    const score = stats.find((stat) => stat.key === 'score');

    expect(name).toMatchObject({ count: 3, missing: 0, unique: 3 });
    expect(score).toMatchObject({ count: 3, sum: 13, min: 1, max: 10 });
    expect(score?.mean).toBeCloseTo(13 / 3);
  });

  it('counts missing values', () => {
    const withGaps: DataTable = {
      columns: [{ key: 'x', label: 'X', type: 'number' }],
      rows: [{ x: 1 }, { x: null }, { x: 3 }],
    };

    const stats = describeTable(withGaps);
    expect(stats[0]).toMatchObject({ count: 3, missing: 1 });
  });
});

describe('applyFilters', () => {
  it('returns the same rows when there are no filters', () => {
    expect(applyFilters(table.rows, [])).toBe(table.rows);
  });

  it('matches text with contains and equals', () => {
    expect(
      applyFilters(table.rows, [{ column: 'name', operator: 'contains', value: 'b' }]),
    ).toEqual([table.rows[0]]);
    expect(applyFilters(table.rows, [{ column: 'name', operator: 'equals', value: 'A' }])).toEqual([
      table.rows[1],
    ]);
  });

  it('compares numbers with greaterThan and lessThan', () => {
    expect(
      applyFilters(table.rows, [{ column: 'score', operator: 'greaterThan', value: '5' }]),
    ).toEqual([table.rows[1]]);
    expect(
      applyFilters(table.rows, [{ column: 'score', operator: 'lessThan', value: '2' }]),
    ).toEqual([table.rows[2]]);
  });

  it('ANDs multiple filters', () => {
    const result = applyFilters(table.rows, [
      { column: 'name', operator: 'contains', value: 'a' },
      { column: 'score', operator: 'greaterThan', value: '3' },
    ]);

    expect(result).toEqual([table.rows[1]]);
  });
});

describe('sortRows', () => {
  it('sorts numerically ascending and descending', () => {
    const ascending = sortRows(table.rows, { key: 'score', direction: 'asc' }, table.columns);
    expect(ascending.map((row) => row.name)).toEqual(['c', 'b', 'a']);

    const descending = sortRows(table.rows, { key: 'score', direction: 'desc' }, table.columns);
    expect(descending.map((row) => row.name)).toEqual(['a', 'b', 'c']);
  });

  it('sorts dates chronologically', () => {
    const ascending = sortRows(table.rows, { key: 'joined', direction: 'asc' }, table.columns);
    expect(ascending.map((row) => row.name)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const original = table.rows.map((row) => row.name);
    sortRows(table.rows, { key: 'score', direction: 'asc' }, table.columns);
    expect(table.rows.map((row) => row.name)).toEqual(original);
  });
});

describe('deriveValues', () => {
  it('accumulates a running total', () => {
    expect(deriveValues(table.rows, 'score', 'cumulative')).toEqual([2, 12, 13]);
  });

  it('computes a share of the absolute total', () => {
    expect(deriveValues(table.rows, 'score', 'percent')).toEqual([
      (2 / 13) * 100,
      (10 / 13) * 100,
      (1 / 13) * 100,
    ]);
  });
});

describe('aggregateByCategory', () => {
  it('sums a numeric column grouped by a category', () => {
    const rows = [
      { team: 'red', points: 1 },
      { team: 'blue', points: 2 },
      { team: 'red', points: 3 },
    ];

    expect(aggregateByCategory(rows, 'team', 'points')).toEqual([
      { label: 'red', value: 4 },
      { label: 'blue', value: 2 },
    ]);
  });
});

describe('column helpers', () => {
  it('lists numeric columns and picks a date x-axis first', () => {
    expect(getNumericColumns(table).map((column) => column.key)).toEqual(['score']);
    expect(pickXColumn(table)?.key).toBe('joined');
  });

  it('formats numbers and passes strings through', () => {
    expect(formatCell(1234, 'number')).toBe(new Intl.NumberFormat().format(1234));
    expect(formatCell('hello', 'string')).toBe('hello');
    expect(formatCell(null, 'number')).toBe('');
  });
});
