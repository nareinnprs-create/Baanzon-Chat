import { seriesBackgroundClass } from './palette';

export interface LegendItem {
  key: string;
  label: string;
  index: number;
}

interface ChartLegendProps {
  ariaLabel: string;
  items: LegendItem[];
}

/** Shared chart legend: a swatch and label per series. */
export default function ChartLegend({ ariaLabel, items }: ChartLegendProps) {
  if (items.length === 0) {
    return null;
  }
  return (
    <ul
      aria-label={ariaLabel}
      className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-text-secondary"
    >
      {items.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`size-2.5 rounded-full ${seriesBackgroundClass(item.index)}`}
          />
          <span className="text-text-primary">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
