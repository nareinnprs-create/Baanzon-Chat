import { useId } from 'react';
import type { DataLabChartOption } from './echarts';
import type { BarChartProps } from '../types';
import ChartDataTable from './ChartDataTable';
import { cartesianBase } from './options';
import ChartLegend from './ChartLegend';
import ChartEmpty from './ChartEmpty';
import useEChart from './useEChart';

/**
 * ECharts grouped bar chart. Same props contract as the previous SVG
 * renderer: one group per row, one bar per series, all bars measured
 * against a zero baseline (the value axis is forced to include zero). The
 * canvas is mounted on a `role="img"` container carrying the localized
 * accessible name; a visually hidden data table mirrors the plotted values
 * for screen readers (the canvas itself is invisible to them).
 */
export default function BarChart({
  data,
  x,
  xLabel,
  series,
  ariaLabel,
  title,
  description,
  emptyLabel,
  className,
}: BarChartProps) {
  const containerRef = useEChart(
    (container): DataLabChartOption => ({
      ...cartesianBase({
        container,
        categories: data.map((row, index) => x(row, index)),
        seriesCount: series.length,
        xLabel,
        pointer: 'shadow',
      }),
      series: series.map((definition) => ({
        type: 'bar',
        name: definition.label,
        data: data.map((row, index) => definition.value(row, index)),
      })),
    }),
  );
  const descriptionId = useId();

  if (data.length === 0 || series.length === 0) {
    return <ChartEmpty ariaLabel={ariaLabel} label={emptyLabel} className={className} />;
  }

  const tableColumns = [xLabel ?? '', ...series.map((definition) => definition.label)];
  const tableRows = data.map((row, index) => [
    x(row, index),
    ...series.map((definition) => String(definition.value(row, index))),
  ]);

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
      <ChartLegend
        ariaLabel={ariaLabel}
        items={series.map((definition, index) => ({
          key: definition.key,
          label: definition.label,
          index,
        }))}
      />
      <ChartDataTable caption={ariaLabel} columns={tableColumns} rows={tableRows} />
    </figure>
  );
}
