import type { DataCellValue, DataColumn, DataColumnType, DataRow, DataTable } from './types';

export type DataFormat = 'csv' | 'json';

const ISO_DATE_PATTERN =
  /^\d{4}-\d{1,2}-\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const SLASH_DATE_PATTERN = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a raw value reads as a finite number. Blank strings are not numbers. */
export function isNumericValue(value: DataCellValue): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return false;
  }
  return Number.isFinite(Number(trimmed));
}

/** Whether a raw value reads as an ISO or slash-separated date. */
export function isDateValue(value: DataCellValue): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (!ISO_DATE_PATTERN.test(trimmed) && !SLASH_DATE_PATTERN.test(trimmed)) {
    return false;
  }
  return !Number.isNaN(Date.parse(trimmed));
}

/**
 * Infer a column's type from its values: `number` when every present value is
 * numeric, then `date` when every present value parses as a date, otherwise
 * `string`. A column with no values is a string.
 */
export function inferColumnType(values: DataCellValue[]): DataColumnType {
  let present = 0;
  let allNumbers = true;
  let allDates = true;
  for (const value of values) {
    if (value === null || value === undefined || value === '') {
      continue;
    }
    present += 1;
    if (allNumbers && !isNumericValue(value)) {
      allNumbers = false;
    }
    if (allDates && !isDateValue(value)) {
      allDates = false;
    }
    if (!allNumbers && !allDates) {
      break;
    }
  }
  if (present === 0) {
    return 'string';
  }
  if (allNumbers) {
    return 'number';
  }
  if (allDates) {
    return 'date';
  }
  return 'string';
}

/** Coerce a cell to a finite number, or `null` when it does not read as one. */
export function coerceNumber(value: DataCellValue): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Render a cell as text without locale-specific formatting. */
export function toText(value: DataCellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function toCell(value: unknown): DataCellValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

function recordFromEntry(entry: Record<string, unknown>): DataRow {
  const record: DataRow = {};
  for (const key of Object.keys(entry)) {
    record[key] = toCell(entry[key]);
  }
  return record;
}

/**
 * Re-derive every column's type from the rows and return a new table. Used by
 * both parsers so inference lives in one place.
 */
function withInferredTypes(table: DataTable): DataTable {
  const columns = table.columns.map((column) => ({
    ...column,
    type: inferColumnType(table.rows.map((row) => row[column.key] ?? null)),
  }));
  return { columns, rows: table.rows };
}

function makeColumns(keys: string[]): DataColumn[] {
  return keys.map((key) => ({ key, label: key, type: 'string' as DataColumnType }));
}

/** Turn a header row into unique, non-empty keys, preserving order. */
function makeUniqueKeys(header: string[]): string[] {
  const used = new Set<string>();
  return header.map((raw, index) => {
    const base = raw.trim() === '' ? `column_${index + 1}` : raw.trim();
    let key = base;
    let suffix = 2;
    while (used.has(key)) {
      key = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(key);
    return key;
  });
}

function matrixToTable(matrix: string[][]): DataTable {
  if (matrix.length === 0) {
    return { columns: [], rows: [] };
  }
  const header = matrix[0];
  const keys = makeUniqueKeys(header);
  const columns = keys.map((key, index) => ({
    key,
    label: header[index]?.trim() === '' ? key : header[index].trim(),
    type: 'string' as DataColumnType,
  }));
  const rows = matrix.slice(1).map((values) => {
    const record: DataRow = {};
    keys.forEach((key, index) => {
      record[key] = values[index] ?? null;
    });
    return record;
  });
  return withInferredTypes({ columns, rows });
}

function recordsToTable(records: DataRow[]): DataTable {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  const rows = records.map((record) => {
    const normalized: DataRow = {};
    for (const key of keys) {
      normalized[key] = record[key] ?? null;
    }
    return normalized;
  });
  return withInferredTypes({ columns: makeColumns(keys), rows });
}

/** Split CSV text into a matrix, honoring quotes, escaped quotes and CRLF. */
export function parseCsvMatrix(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (char === '\r') {
      index += 1;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => !(entry.length === 1 && entry[0] === ''));
}

/** Parse CSV text into a {@link DataTable}, inferring each column's type. */
export function parseCsv(text: string): DataTable {
  return matrixToTable(parseCsvMatrix(text));
}

function jsonToTable(value: unknown): DataTable {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { columns: [], rows: [] };
    }
    if (value.every(isPlainObject)) {
      return recordsToTable(
        value.map((entry) => recordFromEntry(entry as Record<string, unknown>)),
      );
    }
    if (Array.isArray(value[0])) {
      return matrixToTable(
        value.map((entry) =>
          Array.isArray(entry) ? entry.map((cell) => toText(toCell(cell))) : [],
        ),
      );
    }
    return recordsToTable(value.map((entry) => ({ value: toCell(entry) })));
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    const columnar = entries.length > 0 && entries.every(([, entry]) => Array.isArray(entry));
    if (columnar) {
      const length = Math.max(0, ...entries.map(([, entry]) => (entry as unknown[]).length));
      const rows: DataRow[] = Array.from({ length }, (_, rowIndex) => {
        const record: DataRow = {};
        for (const [key, entry] of entries) {
          record[key] = toCell((entry as unknown[])[rowIndex]);
        }
        return record;
      });
      return withInferredTypes({ columns: makeColumns(entries.map(([key]) => key)), rows });
    }
    return recordsToTable([recordFromEntry(value)]);
  }

  throw new Error('Unsupported JSON dataset: expected an object or an array of records.');
}

/** Parse JSON text into a {@link DataTable}. Accepts array-of-records, columnar objects, matrices and primitives. */
export function parseJson(text: string): DataTable {
  return jsonToTable(JSON.parse(text));
}

/** Best-effort format detection used when the caller does not know the format. */
export function detectFormat(text: string): DataFormat {
  const trimmed = text.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[') ? 'json' : 'csv';
}

/** Parse a dataset in the given (or detected) format. */
export function parseTable(text: string, format?: DataFormat): DataTable {
  const resolved = format ?? detectFormat(text);
  return resolved === 'json' ? parseJson(text) : parseCsv(text);
}
