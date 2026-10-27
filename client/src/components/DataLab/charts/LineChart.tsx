import type { LineChartProps } from '../types';
import {
  CHART_HEIGHT,
  CHART_WIDTH,
  DEFAULT_CHART_MARGIN,
  formatAxisNumber,
  labelStride,
  niceTicks,
  scaleLinear,
  valueDomain,
} from './geometry';
import { seriesFillClass, seriesStrokeClass } from './palette';
import ChartDataTable from './ChartDataTable';
import ChartLegend from './ChartLegend';
import ChartEmpty from './ChartEmpty';

/**
 * Dependency-free responsive line chart. The viewBox is fixed at
 * {@link CHART_WIDTH}×{@link CHART_HEIGHT} and scales to its container; the
 * enclosing element supplies the height. A visually hidden data table mirrors
 * the plotted values for screen readers.
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
  if (data.length === 0 || series.length === 0) {
    return <ChartEmpty ariaLabel={ariaLabel} label={emptyLabel} className={className} />;
  }

  const margin = DEFAULT_CHART_MARGIN;
  const plotWidth = CHART_WIDTH - margin.left - margin.right;
  const plotHeight = CHART_HEIGHT - margin.top - margin.bottom;
  const values = series.flatMap((definition) =>
    data.map((row, index) => definition.value(row, index)),
  );
  const [domainMin, domainMax] = valueDomain(values);
  const ticks = niceTicks(domainMin, domainMax, 5);
  const tickMin = ticks[0];
  const tickMax = ticks[ticks.length - 1];

  const xFor = (index: number): number => {
    if (data.length <= 1) {
      return margin.left + plotWidth / 2;
    }
    return margin.left + (index / (data.length - 1)) * plotWidth;
  };
  const yFor = (value: number): number =>
    margin.top + scaleLinear(value, tickMin, tickMax, plotHeight, 0);
  const baseline = yFor(Math.max(0, tickMin));
  const stride = labelStride(data.length);
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
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-auto w-full text-text-secondary"
        preserveAspectRatio="xMidYMid meet"
      >
        {description ? <desc>{description}</desc> : null}
        {ticks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              x1={margin.left}
              x2={margin.left + plotWidth}
              y1={yFor(tick)}
              y2={yFor(tick)}
              className="stroke-border-light"
              strokeWidth={1}
            />
            <text
              x={margin.left - 8}
              y={yFor(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              className="fill-text-secondary"
            >
              {formatAxisNumber(tick)}
            </text>
          </g>
        ))}
        <line
          x1={margin.left}
          x2={margin.left + plotWidth}
          y1={baseline}
          y2={baseline}
          className="stroke-border-medium"
          strokeWidth={1}
        />
        {data.map((row, index) =>
          index % stride === 0 ? (
            <text
              key={`x-${index}`}
              x={xFor(index)}
              y={CHART_HEIGHT - margin.bottom + 18}
              textAnchor="middle"
              fontSize={11}
              className="fill-text-secondary"
            >
              {x(row, index)}
            </text>
          ) : null,
        )}
        {series.map((definition, seriesIndex) => {
          const points = data
            .map((row, index) => `${xFor(index)},${yFor(definition.value(row, index))}`)
            .join(' ');
          return (
            <g key={definition.key}>
              <polyline
                points={points}
                fill="none"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                className={seriesStrokeClass(seriesIndex)}
              />
              {data.map((row, index) => (
                <circle
                  key={`${definition.key}-${index}`}
                  cx={xFor(index)}
                  cy={yFor(definition.value(row, index))}
                  r={2.5}
                  className={seriesFillClass(seriesIndex)}
                />
              ))}
            </g>
          );
        })}
        {xLabel ? (
          <text
            x={margin.left + plotWidth / 2}
            y={CHART_HEIGHT - 4}
            textAnchor="middle"
            fontSize={11}
            className="fill-text-secondary"
          >
            {xLabel}
          </text>
        ) : null}
      </svg>
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
