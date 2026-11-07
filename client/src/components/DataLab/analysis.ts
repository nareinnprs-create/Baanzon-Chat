import type {
  ColumnStats,
  DataCellValue,
  DataColumn,
  DataColumnType,
  DataFilter,
  DataRow,
  DataTable,
  DeriveMode,
  SortState,
} from './types';
import { coerceNumber } from './parse';

/** Per-column summary used by the "Describe" action. */
export function describeTable(table: DataTable): ColumnStats[] {
  return table.columns.map((column) => {
    const values = table.rows.map((row) => row[column.key] ?? null);
    const present = values.filter((value) => value !== null && value !== undefined && value !== '');
    const stats: ColumnStats = {
      key: column.key,
      label: column.label,
      type: column.type,
      count: table.rows.length,
      missing: table.rows.length - present.length,
      unique: new Set(present.map((value) => String(value))).size,
    };
    if (column.type === 'number') {
      const numeric = present.map(coerceNumber).filter((value): value is number => value !== null);
      if (numeric.length > 0) {
        const sum = numeric.reduce((total, value) => total + value, 0);
        stats.min = Math.min(...numeric);
        stats.max = Math.max(...numeric);
        stats.sum = sum;
        stats.mean = sum / numeric.length;
      }
    }
    return stats;
  });
}

function matchesFilter(row: DataRow, filter: DataFilter): boolean {
  const raw = row[filter.column] ?? null;
  if (filter.operator === 'contains') {
    return String(raw ?? '')
      .toLowerCase()
      .includes(filter.value.toLowerCase());
  }
  if (filter.operator === 'equals') {
    return String(raw ?? '').toLowerCase() === filter.value.toLowerCase();
  }
  const left = coerceNumber(raw);
  const right = coerceNumber(filter.value);
  if (left === null || right === null) {
    return false;
  }
  return filter.operator === 'greaterThan' ? left > right : left < right;
}

/** Keep only rows that satisfy every filter. */
export function applyFilters(rows: DataRow[], filters: DataFilter[]): DataRow[] {
  if (filters.length === 0) {
    return rows;
  }
  return rows.filter((row) => filters.every((filter) => matchesFilter(row, filter)));
}

function compareValues(left: DataCellValue, right: DataCellValue, type: DataColumnType): number {
  if (left === null || left === undefined) {
    return right === null || right === undefined ? 0 : 1;
  }
  if (right === null || right === undefined) {
    return -1;
  }
  if (type === 'number') {
    const a = coerceNumber(left);
    const b = coerceNumber(right);
    if (a === null || b === null) {
      if (a === b) {
        return 0;
      }
      return a === null ? 1 : -1;
    }
    return a - b;
  }
  if (type === 'date') {
    const a = Date.parse(String(left));
    const b = Date.parse(String(right));
    if (Number.isNaN(a) || Number.isNaN(b)) {
      if (Number.isNaN(a) && Number.isNaN(b)) {
        return 0;
      }
      return Number.isNaN(a) ? 1 : -1;
    }
    return a - b;
  }
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

/** Return a sorted copy of the rows. Missing values sort last on ascending order. */
export function sortRows(
  rows: DataRow[],
  sort: SortState | null,
  columns: DataColumn[],
): DataRow[] {
  if (!sort) {
    return rows;
  }
  const type = columns.find((column) => column.key === sort.key)?.type ?? 'string';
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort(
    (left, right) =>
      direction * compareValues(left[sort.key] ?? null, right[sort.key] ?? null, type),
  );
}

/** Compute a derived numeric series for a column across the given rows. */
export function deriveValues(rows: DataRow[], column: string, mode: DeriveMode): number[] {
  const values = rows.map((row) => coerceNumber(row[column] ?? null) ?? 0);
  if (mode === 'cumulative') {
    let running = 0;
    return values.map((value) => {
      running += value;
      return running;
    });
  }
  const total = values.reduce((sum, value) => sum + Math.abs(value), 0);
  if (total === 0) {
    return values.map(() => 0);
  }
  return values.map((value) => (Math.abs(value) / total) * 100);
}

/** Sum a numeric column grouped by a category column, preserving first-seen order. */
export function aggregateByCategory(
  rows: DataRow[],
  categoryKey: string,
  valueKey: string,
): Array<{ label: string; value: number }> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const label = String(row[categoryKey] ?? '');
    const value = coerceNumber(row[valueKey] ?? null) ?? 0;
    totals.set(label, (totals.get(label) ?? 0) + value);
  }
  return [...totals.entries()].map(([label, value]) => ({ label, value }));
}

export function getNumericColumns(table: DataTable): DataColumn[] {
  return table.columns.filter((column) => column.type === 'number');
}

/** Prefer a date column, then text, then whatever exists, as the x axis. */
export function pickXColumn(table: DataTable): DataColumn | undefined {
  return (
    table.columns.find((column) => column.type === 'date') ??
    table.columns.find((column) => column.type === 'string') ??
    table.columns[0]
  );
}

/** Human-readable cell text: numbers are grouped, everything else is verbatim. */
export function formatCell(value: DataCellValue, type: DataColumnType): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (type === 'number') {
    const numeric = coerceNumber(value);
    return numeric === null ? String(value) : new Intl.NumberFormat().format(numeric);
  }
  return String(value);
}
