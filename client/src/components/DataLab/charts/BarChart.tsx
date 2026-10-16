import type { BarChartProps } from '../types';
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
import { seriesFillClass } from './palette';
import ChartLegend from './ChartLegend';
import ChartEmpty from './ChartEmpty';

/**
 * Dependency-free responsive grouped bar chart. One group per row, one bar per
 * series; bars are measured against a zero baseline.
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

  const yFor = (value: number): number =>
    margin.top + scaleLinear(value, tickMin, tickMax, plotHeight, 0);
  const baseline = yFor(Math.max(0, tickMin));

  const categoryWidth = plotWidth / data.length;
  const groupPadding = categoryWidth * 0.15;
  const groupWidth = categoryWidth - groupPadding * 2;
  const barWidth = groupWidth / series.length;
  const stride = labelStride(data.length);

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
        {data.map((row, categoryIndex) => {
          const groupX = margin.left + categoryIndex * categoryWidth + groupPadding;
          return (
            <g key={`group-${categoryIndex}`}>
              {series.map((definition, seriesIndex) => {
                const value = definition.value(row, categoryIndex);
                const y = yFor(value);
                const top = value >= 0 ? y : baseline;
                const height = Math.abs(baseline - y);
                return (
                  <rect
                    key={definition.key}
                    x={groupX + seriesIndex * barWidth}
                    y={top}
                    width={Math.max(1, barWidth * 0.9)}
                    height={Math.max(0, height)}
                    rx={2}
                    className={seriesFillClass(seriesIndex)}
                  />
                );
              })}
            </g>
          );
        })}
        {data.map((row, index) =>
          index % stride === 0 ? (
            <text
              key={`x-${index}`}
              x={margin.left + index * categoryWidth + categoryWidth / 2}
              y={CHART_HEIGHT - margin.bottom + 18}
              textAnchor="middle"
              fontSize={11}
              className="fill-text-secondary"
            >
              {x(row, index)}
            </text>
          ) : null,
        )}
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
    </figure>
  );
}
