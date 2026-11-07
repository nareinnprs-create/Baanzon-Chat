import { useId } from 'react';
import type { DataLabChartOption } from './echarts';
import type { PieChartProps } from '../types';
import { seriesColors, tokenColor } from './theme';
import { seriesBackgroundClass } from './palette';
import ChartEmpty from './ChartEmpty';
import useEChart from './useEChart';

interface PieSlice {
  label: string;
  value: number;
  index: number;
}

/**
 * ECharts pie chart. Same props contract as the previous SVG renderer: a row
 * with a non-positive value is skipped; the remaining values drive each
 * slice's share of the whole, and slices are separated by the surface color
 * the old 2px stroke provided. The canvas is mounted on a `role="img"`
 * container carrying the localized accessible name. The slice list doubles
 * as the accessible data fallback, carrying the exact value (visually
 * hidden) next to the rounded share.
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

  const containerRef = useEChart((container): DataLabChartOption => {
    const colors = seriesColors(container, slices.length);
    const surfacePrimary = tokenColor(container, '--surface-primary');
    const textPrimary = tokenColor(container, '--text-primary');
    const borderLight = tokenColor(container, '--border-light');
    return {
      ...(colors.length > 0 ? { color: colors } : {}),
      tooltip: {
        trigger: 'item',
        confine: true,
        ...(surfacePrimary ? { backgroundColor: surfacePrimary } : {}),
        ...(borderLight ? { borderColor: borderLight } : {}),
        ...(textPrimary ? { textStyle: { color: textPrimary } } : {}),
      },
      series: [
        {
          type: 'pie',
          data: slices.map((slice) => ({ name: slice.label, value: slice.value })),
          center: ['50%', '50%'],
          radius: '85%',
          label: { show: false },
          labelLine: { show: false },
          itemStyle: {
            borderWidth: 2,
            ...(surfacePrimary ? { borderColor: surfacePrimary } : {}),
          },
        },
      ],
    };
  });
  const descriptionId = useId();

  if (slices.length === 0 || total <= 0) {
    return <ChartEmpty ariaLabel={ariaLabel} label={emptyLabel} className={className} />;
  }

  return (
    <figure className={className}>
      {title ? (
        <figcaption className="mb-2 text-sm font-medium text-text-primary">{title}</figcaption>
      ) : null}
      <div
        ref={containerRef}
        role="img"
        aria-label={ariaLabel}
        aria-describedby={description ? descriptionId : undefined}
        className="aspect-[2/1] w-full"
      />
      {description ? (
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      ) : null}
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
            <span className="sr-only">{` (${slice.value})`}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
