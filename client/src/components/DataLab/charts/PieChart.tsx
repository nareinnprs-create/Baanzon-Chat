import type { PieChartProps } from '../types';
import { seriesFillClass, seriesBackgroundClass } from './palette';
import { CHART_HEIGHT, CHART_WIDTH } from './geometry';
import ChartEmpty from './ChartEmpty';

function polar(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function arcPath(cx: number, cy: number, radius: number, start: number, end: number): string {
  const startPoint = polar(cx, cy, radius, start);
  const endPoint = polar(cx, cy, radius, end);
  const largeArc = end - start > 180 ? 1 : 0;
  return [
    `M ${cx} ${cy}`,
    `L ${startPoint.x} ${startPoint.y}`,
    `A ${radius} ${radius} 0 ${largeArc} 1 ${endPoint.x} ${endPoint.y}`,
    'Z',
  ].join(' ');
}

interface PieSlice {
  label: string;
  value: number;
  index: number;
}

/**
 * Dependency-free responsive pie chart. A row with a non-positive value is
 * skipped; the remaining values drive each slice's share of the whole.
 */
export default function PieChart({
  data,
  category,
  value,
  ariaLabel,
  title,
  description,
  emptyLabel,
  className,
}: PieChartProps) {
  const slices: PieSlice[] = data
    .map((row, index) => ({ label: category(row, index), value: value(row, index), index }))
    .filter((slice) => slice.value > 0);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);

  if (slices.length === 0 || total <= 0) {
    return <ChartEmpty ariaLabel={ariaLabel} label={emptyLabel} className={className} />;
  }

  const cx = CHART_WIDTH / 2;
  const cy = CHART_HEIGHT / 2;
  const radius = Math.min(cx, cy) - 24;
  let angle = 0;

  return (
    <figure className={className}>
      {title ? (
        <figcaption className="mb-2 text-sm font-medium text-text-primary">{title}</figcaption>
      ) : null}
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {description ? <desc>{description}</desc> : null}
        {slices.map((slice) => {
          const start = angle;
          const sweep = (slice.value / total) * 360;
          angle += sweep;
          return (
            <path
              key={`${slice.label}-${slice.index}`}
              d={arcPath(cx, cy, radius, start, angle)}
              strokeWidth={2}
              className={`stroke-surface-primary ${seriesFillClass(slice.index)}`}
            />
          );
        })}
      </svg>
      <ul
        aria-label={ariaLabel}
        className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-text-secondary"
      >
        {slices.map((slice) => (
          <li key={`${slice.label}-${slice.index}`} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`size-2.5 rounded-full ${seriesBackgroundClass(slice.index)}`}
            />
            <span className="text-text-primary">{slice.label}</span>
            <span>{`${Math.round((slice.value / total) * 100)}%`}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
