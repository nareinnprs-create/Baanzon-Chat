import { useId } from 'react';
import type { DataLabChartOption } from './echarts';
import type { LineChartProps } from '../types';
import ChartDataTable from './ChartDataTable';
import { cartesianBase } from './options';
import ChartLegend from './ChartLegend';
import ChartEmpty from './ChartEmpty';
import useEChart from './useEChart';

/**
 * ECharts line chart. Same props contract as the previous SVG renderer: one
 * series definition per line, points sampled through the accessors. The
 * canvas is mounted on a `role="img"` container carrying the localized
 * accessible name, sized at the same 2:1 ratio the fixed 640×320 viewBox
 * scaled to; a visually hidden data table mirrors the plotted values for
 * screen readers (the canvas itself is invisible to them).
 */
export default function LineChart({
  data,
  x,
  xLabel,
  series,
  ariaLabel,
  title,
  description,
  emptyLabel,
  className,
}: LineChartProps) {
  const containerRef = useEChart(
    (container): DataLabChartOption => ({
      ...cartesianBase({
        container,
        categories: data.map((row, index) => x(row, index)),
        seriesCount: series.length,
        xLabel,
        pointer: 'line',
      }),
      series: series.map((definition) => ({
        type: 'line',
        name: definition.label,
        data: data.map((row, index) => definition.value(row, index)),
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2 },
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
