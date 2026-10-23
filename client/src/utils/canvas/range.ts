/**
 * Pure range/clamp helpers for the Canvas feature.
 *
 * These are intentionally generic (no Canvas types) so they can be reused and
 * unit-tested in isolation. Canvas-specific logic remains in the reducer.
 */

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  const result = Math.min(max, Math.max(min, value));
  return result;
}

export function clampIndex(value: number, max: number): number {
  if (Number.isNaN(value) || value < 0) {
    return 0;
  }
  return Math.min(max, value);
}

export function replaceRange(
  text: string,
  start: number,
  end: number,
  replacement: string,
): string {
  const from = clampIndex(start, text.length);
  const to = Math.max(from, clampIndex(end, text.length));
  return `${text.slice(0, from)}${replacement}${text.slice(to)}`;
}

export function clampRange(
  start: number,
  end: number,
  maxLength: number,
): { start: number; end: number } {
  const s = clampIndex(start, maxLength);
  const e = clampIndex(end, maxLength);
  return { start: Math.min(s, e), end: Math.max(s, e) };
}
