import { formatTimestamp } from '../time';

describe('canvas time utils', () => {
  it('returns the original string if the timestamp is invalid', () => {
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
  });

  it('formats a valid ISO timestamp', () => {
    const result = formatTimestamp('2026-01-01T00:00:00.000Z', 'en-US');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
