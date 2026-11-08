/**
 * Semantic categorical palette for charts. Each entry is a full Tailwind class
 * literal so the JIT can see it; the seven slots map onto the theme's
 * `--series-1`..`--series-7` roles.
 */
const FILL_CLASSES = [
  'fill-series-1',
  'fill-series-2',
  'fill-series-3',
  'fill-series-4',
  'fill-series-5',
  'fill-series-6',
  'fill-series-7',
] as const;

const STROKE_CLASSES = [
  'stroke-series-1',
  'stroke-series-2',
  'stroke-series-3',
  'stroke-series-4',
  'stroke-series-5',
  'stroke-series-6',
  'stroke-series-7',
] as const;

const BG_CLASSES = [
  'bg-series-1',
  'bg-series-2',
  'bg-series-3',
  'bg-series-4',
  'bg-series-5',
  'bg-series-6',
  'bg-series-7',
] as const;

const SLOT_COUNT = FILL_CLASSES.length;

function slot(index: number): number {
  return ((index % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT;
}

export function seriesFillClass(index: number): string {
  return FILL_CLASSES[slot(index)];
}

export function seriesStrokeClass(index: number): string {
  return STROKE_CLASSES[slot(index)];
}

export function seriesBackgroundClass(index: number): string {
  return BG_CLASSES[slot(index)];
}
