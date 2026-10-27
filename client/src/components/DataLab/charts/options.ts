import type { DataLabChartOption } from './echarts';
import { seriesColors, tokenColor } from './theme';
import { formatAxisNumber } from './geometry';

interface CartesianBaseInput {
  /** A rendered element the theme tokens are read from (the chart container). */
  container: Element;
  /** One x-axis label per plotted row. */
  categories: string[];
  /** How many series share the categorical palette. */
  seriesCount: number;
  /** Optional localized x-axis name, rendered centered under the axis. */
  xLabel?: string;
  /** Axis pointer style: a line for line charts, a shadow for bars. */
  pointer?: 'line' | 'shadow';
}

/**
 * Axis scaffolding shared by the cartesian charts, restyled from the same
 * theme tokens the SVG charts painted with: `--text-secondary` labels,
 * `--border-light` grid lines and a `--border-medium` axis line. The value
 * axis always includes zero, matching the previous `valueDomain` behavior,
 * and y ticks keep the compact number formatting (`formatAxisNumber`).
 * Unreadable tokens are omitted so ECharts' defaults apply (jsdom).
 */
export function cartesianBase({
  container,
  categories,
  seriesCount,
  xLabel,
  pointer = 'line',
}: CartesianBaseInput): DataLabChartOption {
  const colors = seriesColors(container, seriesCount);
  const textPrimary = tokenColor(container, '--text-primary');
  const textSecondary = tokenColor(container, '--text-secondary');
  const borderLight = tokenColor(container, '--border-light');
  const borderMedium = tokenColor(container, '--border-medium');
  const surfacePrimary = tokenColor(container, '--surface-primary');

  return {
    ...(colors.length > 0 ? { color: colors } : {}),
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: pointer },
      confine: true,
      ...(surfacePrimary ? { backgroundColor: surfacePrimary } : {}),
      ...(borderLight ? { borderColor: borderLight } : {}),
      ...(textPrimary ? { textStyle: { color: textPrimary } } : {}),
    },
    xAxis: {
      type: 'category',
      data: categories,
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { fontSize: 11, ...(textSecondary ? { color: textSecondary } : {}) },
      axisLine: { lineStyle: { ...(borderMedium ? { color: borderMedium } : {}) } },
      axisTick: { show: false },
      axisLabel: {
        fontSize: 11,
        hideOverlap: true,
        ...(textSecondary ? { color: textSecondary } : {}),
      },
      ...(xLabel ? { name: xLabel } : {}),
    },
    yAxis: {
      type: 'value',
      min: (extent) => Math.min(0, extent.min),
      max: (extent) => Math.max(0, extent.max),
      axisLabel: {
        fontSize: 11,
        formatter: (value: number) => formatAxisNumber(value),
        ...(textSecondary ? { color: textSecondary } : {}),
      },
      splitLine: { lineStyle: { ...(borderLight ? { color: borderLight } : {}) } },
    },
  };
}
