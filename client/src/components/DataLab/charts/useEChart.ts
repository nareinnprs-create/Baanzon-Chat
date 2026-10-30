import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { ChartInstance, DataLabChartOption } from './echarts';
import { initChart } from './echarts';

/**
 * Mounts an ECharts instance on the returned container ref. The instance is
 * created once per mount, follows its container through a ResizeObserver
 * (`chart.resize()`), repaints when the app flips light/dark — a canvas
 * cannot follow CSS variable changes the way the previous SVG charts did,
 * so the class-attribute flips are watched and the option rebuilt — and is
 * disposed on unmount. `buildOption` runs lazily at effect time so token
 * colors are read from the attached container, and on every render so any
 * data/prop change lands as a series-replacing merge.
 */
export default function useEChart(
  buildOption: (container: HTMLDivElement) => DataLabChartOption,
): RefObject<HTMLDivElement> {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartInstance | null>(null);
  const buildRef = useRef(buildOption);
  buildRef.current = buildOption;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    const chart = initChart(container);
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(container);

    const themeObserver = new MutationObserver(() => {
      chartRef.current?.setOption(buildRef.current(container), { replaceMerge: ['series'] });
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    return () => {
      themeObserver.disconnect();
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    chartRef.current?.setOption(buildRef.current(container), { replaceMerge: ['series'] });
  });

  return containerRef;
}
