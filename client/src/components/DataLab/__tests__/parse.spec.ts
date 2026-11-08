import {
  coerceNumber,
  detectFormat,
  inferColumnType,
  isDateValue,
  isNumericValue,
  parseCsv,
  parseJson,
  parseTable,
} from '../parse';

describe('parseCsv', () => {
  it('parses a header and rows, inferring number and date columns', () => {
    const table = parseCsv('name,age,joined\nAda,31,2020-01-02\nAlan,29,2021-03-04\n');

    expect(table.columns.map((column) => column.key)).toEqual(['name', 'age', 'joined']);
    expect(table.columns.map((column) => column.type)).toEqual(['string', 'number', 'date']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toEqual({ name: 'Ada', age: '31', joined: '2020-01-02' });
  });

  it('honors quoted fields with commas, newlines and escaped quotes', () => {
    const table = parseCsv('label,note\n"a,b","line1\nline2"\n"she said ""hi""","plain"\n');

    expect(table.rows[0].label).toBe('a,b');
    expect(table.rows[0].note).toBe('line1\nline2');
    expect(table.rows[1].label).toBe('she said "hi"');
  });

  it('fills missing cells with null and ignores blank lines', () => {
    const table = parseCsv('a,b,c\n1,2\n\n3,4,5\n');

    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toEqual({ a: '1', b: '2', c: null });
  });

  it('uniquifies empty and duplicate headers', () => {
    const table = parseCsv('a,a,\n1,2,3\n');

    expect(table.columns.map((column) => column.key)).toEqual(['a', 'a_2', 'column_3']);
  });
});

describe('inferColumnType', () => {
  it('returns number when every present value is numeric', () => {
    expect(inferColumnType(['1', '2.5', '-3'])).toBe('number');
  });

  it('returns date when every present value parses as a date', () => {
    expect(inferColumnType(['2020-01-01', '2021-02-03T04:05:06Z'])).toBe('date');
  });

  it('returns string for mixed values', () => {
    expect(inferColumnType(['1', 'x'])).toBe('string');
  });

  it('returns string when there is nothing to infer from', () => {
    expect(inferColumnType([null, ''])).toBe('string');
  });
});

describe('numeric and date value guards', () => {
  it('treats blanks and non-finite numbers as non-numeric', () => {
    expect(isNumericValue('')).toBe(false);
    expect(isNumericValue('   ')).toBe(false);
    expect(isNumericValue('Infinity')).toBe(false);
    expect(isNumericValue(2)).toBe(true);
    expect(isNumericValue('2.5')).toBe(true);
  });

  it('only accepts realistic date strings', () => {
    expect(isDateValue('2020-01-02')).toBe(true);
    expect(isDateValue('01/02/2020')).toBe(true);
    expect(isDateValue('2020')).toBe(false);
    expect(isDateValue('not a date')).toBe(false);
  });

  it('coerces numeric cells and rejects the rest', () => {
    expect(coerceNumber('3.5')).toBe(3.5);
    expect(coerceNumber(7)).toBe(7);
    expect(coerceNumber('n/a')).toBeNull();
    expect(coerceNumber(null)).toBeNull();
  });
});

describe('parseJson', () => {
  it('parses an array of records and unions the keys', () => {
    const table = parseJson('[{"a":1},{"b":"x","a":2}]');

    expect(table.columns.map((column) => column.key)).toEqual(['a', 'b']);
    expect(table.rows[0]).toEqual({ a: 1, b: null });
    expect(table.columns.find((column) => column.key === 'a')?.type).toBe('number');
  });

  it('parses a columnar object', () => {
    const table = parseJson('{"x":[1,2,3],"y":[4,5,6]}');

    expect(table.columns.map((column) => column.key)).toEqual(['x', 'y']);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[2]).toEqual({ x: 3, y: 6 });
  });

  it('parses a matrix with a header row', () => {
    const table = parseJson('[["h1","h2"],["a","1"],["b","2"]]');

    expect(table.columns.map((column) => column.key)).toEqual(['h1', 'h2']);
    expect(table.rows[1]).toEqual({ h1: 'b', h2: '2' });
  });

  it('parses an array of primitives into a single value column', () => {
    const table = parseJson('[1,2,3]');

    expect(table.columns.map((column) => column.key)).toEqual(['value']);
    expect(table.rows).toHaveLength(3);
  });
});

describe('detectFormat and parseTable', () => {
  it('detects JSON from its first non-whitespace character', () => {
    expect(detectFormat('  [{"a":1}]')).toBe('json');
    expect(detectFormat('  {"a":1}')).toBe('json');
    expect(detectFormat('a,b\n1,2')).toBe('csv');
  });

  it('parses using the detected format when none is given', () => {
    expect(parseTable('a,b\n1,2').columns.map((column) => column.key)).toEqual(['a', 'b']);
    expect(parseTable('[{"a":1}]').columns.map((column) => column.key)).toEqual(['a']);
  });
});
