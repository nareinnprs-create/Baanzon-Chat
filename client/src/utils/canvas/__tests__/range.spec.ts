import { clamp, clampIndex, replaceRange, clampRange } from '../range';

describe('canvas range utils', () => {
  it('clamps numbers between bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(Number.NaN, 2, 5)).toBe(2);
  });

  it('clamps indices', () => {
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(-1, 5)).toBe(0);
    expect(clampIndex(10, 5)).toBe(5);
    expect(clampIndex(Number.NaN, 5)).toBe(0);
  });

  it('replaces a range in a string', () => {
    expect(replaceRange('hello', 1, 4, 'a')).toBe('hao');
    expect(replaceRange('hello', 10, 20, 'x')).toBe('hellox');
    expect(replaceRange('test', 0, 0, 'pre')).toBe('pretest');
  });

  it('clamps a selection range', () => {
    expect(clampRange(5, 2, 10)).toEqual({ start: 2, end: 5 });
    expect(clampRange(-1, 20, 5)).toEqual({ start: 0, end: 5 });
  });
});
