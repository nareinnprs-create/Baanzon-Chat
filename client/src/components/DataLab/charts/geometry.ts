/** Shared geometry helpers for the hand-rolled SVG charts. */

export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_CHART_MARGIN: ChartMargin = { top: 16, right: 16, bottom: 36, left: 48 };

/** Nominal drawing surface; the SVG scales this viewBox to its container. */
export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 320;

/** Map a value from a data domain onto a pixel range. */
export function scaleLinear(
  value: number,
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): number {
  if (domainMax === domainMin) {
    return (rangeMin + rangeMax) / 2;
  }
  const ratio = (value - domainMin) / (domainMax - domainMin);
  return rangeMin + ratio * (rangeMax - rangeMin);
}

function niceNumber(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) {
      niceFraction = 1;
    } else if (fraction < 3) {
      niceFraction = 2;
    } else if (fraction < 7) {
      niceFraction = 5;
    } else {
      niceFraction = 10;
    }
  } else if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }
  return niceFraction * 10 ** exponent;
}

/** Evenly spaced, human-friendly tick values covering `[min, max]`. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0];
  }
  if (min === max) {
    return [min];
  }
  const range = niceNumber(max - min, false);
  const step = niceNumber(range / Math.max(1, count - 1), true);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 2; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

export function extent(values: number[]): [number, number] {
  if (values.length === 0) {
    return [0, 1];
  }
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }
  return [min, max];
}

/** A value domain that always includes zero, so bars read against a baseline. */
export function valueDomain(values: number[]): [number, number] {
  const [min, max] = extent(values);
  const lower = Math.min(0, min);
  const upper = Math.max(0, max);
  if (lower === upper) {
    return [0, upper === 0 ? 1 : upper];
  }
  return [lower, upper];
}

function trimNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(1).replace(/\.0$/, '');
}

/** Compact axis tick label (1.5k, 2M) for constrained widths. */
export function formatAxisNumber(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) {
    return `${trimNumber(value / 1_000_000)}M`;
  }
  if (absolute >= 1000) {
    return `${trimNumber(value / 1000)}k`;
  }
  return trimNumber(value);
}

/** Choose a label stride so at most `max` x-axis labels are drawn. */
export function labelStride(length: number, max = 8): number {
  if (length <= max) {
    return 1;
  }
  return Math.ceil(length / max);
}
