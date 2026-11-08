/**
 * Tree-shaken ECharts registration for the Data Lab: the three chart types
 * the view renders, the components their options use and the canvas
 * renderer. Import from here rather than the `echarts` root so the bundle
 * only carries what is registered below.
 */
/* The registration entry point is aliased away from `use`, which the React
 * hooks lint rule mistakes for React 19's `use()` hook. */
import { CanvasRenderer } from 'echarts/renderers';
import { init, use as register } from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import type { BarSeriesOption, LineSeriesOption, PieSeriesOption } from 'echarts/charts';
import type { GridComponentOption, TooltipComponentOption } from 'echarts/components';
import type { ComposeOption } from 'echarts/core';

register([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

/** The option shape the Data Lab charts build (always partial). */
export type DataLabChartOption = Partial<
  ComposeOption<
    | BarSeriesOption
    | GridComponentOption
    | LineSeriesOption
    | PieSeriesOption
    | TooltipComponentOption
  >
>;

export { init as initChart };

/** A live chart instance, as returned by {@link initChart}. */
export type ChartInstance = ReturnType<typeof init>;
