import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, parsePagination } from './pagination';

describe('parsePagination', () => {
  it('applies the default limit and a zero offset when query params are missing', () => {
    expect(parsePagination({})).toEqual({ limit: DEFAULT_PAGE_LIMIT, offset: 0 });
  });

  it('parses numeric strings', () => {
    expect(parsePagination({ limit: '25', offset: '10' })).toEqual({ limit: 25, offset: 10 });
  });

  it('clamps the limit to the inclusive range [1, MAX_PAGE_LIMIT]', () => {
    expect(parsePagination({ limit: '0' }).limit).toBe(1);
    expect(parsePagination({ limit: '-10' }).limit).toBe(1);
    expect(parsePagination({ limit: String(MAX_PAGE_LIMIT) }).limit).toBe(MAX_PAGE_LIMIT);
    expect(parsePagination({ limit: String(MAX_PAGE_LIMIT + 1) }).limit).toBe(MAX_PAGE_LIMIT);
  });

  it('falls back to the default for a non-numeric limit', () => {
    expect(parsePagination({ limit: 'abc' }).limit).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('never returns a negative offset', () => {
    expect(parsePagination({ offset: '-5' }).offset).toBe(0);
    expect(parsePagination({ offset: 'abc' }).offset).toBe(0);
  });

  it('parses leading-integer values like parseInt does', () => {
    expect(parsePagination({ limit: '30px', offset: '7.9' })).toEqual({ limit: 30, offset: 7 });
  });

  it('treats an empty string as missing', () => {
    expect(parsePagination({ limit: '', offset: '' })).toEqual({
      limit: DEFAULT_PAGE_LIMIT,
      offset: 0,
    });
  });
});
