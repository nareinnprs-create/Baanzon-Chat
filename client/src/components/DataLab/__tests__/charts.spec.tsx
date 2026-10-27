import * as echartsCore from 'echarts/core';
import { act, render, screen, within } from '@testing-library/react';
import type { DataRow } from '../types';
import { DATA_LAB_LABELS } from '../labels';
import LineChart from '../charts/LineChart';
import BarChart from '../charts/BarChart';
import PieChart from '../charts/PieChart';

jest.mock('echarts/core', () => ({
  init: jest.fn(),
  use: jest.fn(),
}));
jest.mock('echarts/charts', () => ({
  LineChart: {},
  BarChart: {},
  PieChart: {},
}));
jest.mock('echarts/components', () => ({
  GridComponent: {},
  TooltipComponent: {},
  LegendComponent: {},
}));
jest.mock('echarts/renderers', () => ({
  CanvasRenderer: {},
}));

const initMock = jest.mocked(echartsCore.init);

interface ChartInstanceMock {
  setOption: jest.Mock;
  resize: jest.Mock;
  dispose: jest.Mock;
}

/** `restoreMocks` wipes implementations between tests, so re-prime each one. */
function primeInit(): void {
  initMock.mockImplementation(
    () =>
      ({
        setOption: jest.fn(),
        resize: jest.fn(),
        dispose: jest.fn(),
      }) as unknown as ReturnType<typeof echartsCore.init>,
  );
}

function lastChart(): ChartInstanceMock {
  const results = initMock.mock.results;
  const instance = results[results.length - 1]?.value as ChartInstanceMock | undefined;
  if (!instance) {
    throw new Error('expected the chart to have initialized an ECharts instance');
  }
  return instance;
}

function firstOption(): Record<string, unknown> {
  return lastChart().setOption.mock.calls[0][0] as Record<string, unknown>;
}

interface SeriesOption {
  type: string;
  name?: string;
  data: unknown;
}

function firstSeries(): SeriesOption {
  const { series } = firstOption() as { series: SeriesOption[] };
  return series[0];
}

/**
 * ResizeObserver stand-in capturing the callback, so a resize can be
 * simulated and `chart.resize()` observed (the global setup mock cannot
 * trigger).
 */
class CapturingResizeObserver {
  static instances: CapturingResizeObserver[] = [];

  readonly observe = jest.fn();
  readonly unobserve = jest.fn();
  readonly disconnect = jest.fn();

  constructor(private callback: ResizeObserverCallback) {
    CapturingResizeObserver.instances.push(this);
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const originalResizeObserver = window.ResizeObserver;

beforeEach(() => {
  primeInit();
  CapturingResizeObserver.instances = [];
  window.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  window.ResizeObserver = originalResizeObserver;
});

const data: DataRow[] = [
  { label: 'A', value: 1 },
  { label: 'B', value: 3 },
  { label: 'C', value: 6 },
];

const x = (row: DataRow) => String(row.label ?? '');
const series = [{ key: 'value', label: 'Value', value: (row: DataRow) => Number(row.value ?? 0) }];

function rowCells(table: HTMLElement, columnIndex: number): string[] {
  return Array.from(table.querySelectorAll('tbody tr')).map(
    (row) => row.children[columnIndex].textContent ?? '',
  );
}

describe('LineChart', () => {
  it('exposes an accessible label and a legend', () => {
    render(<LineChart data={data} x={x} series={series} ariaLabel="Trend line chart" />);

    expect(screen.getByRole('img', { name: 'Trend line chart' })).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: 'Trend line chart' });
    expect(within(legend).getByText('Value')).toBeInTheDocument();
  });

  it('mirrors the plotted data in a visually hidden table', () => {
    render(
      <LineChart data={data} x={x} xLabel="Month" series={series} ariaLabel="Trend line chart" />,
    );

    const table = screen.getByRole('table');
    expect(within(table).getByText('Trend line chart')).toBeInTheDocument();
    expect(Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual([
      'Month',
      'Value',
    ]);
    expect(rowCells(table, 0)).toEqual(['A', 'B', 'C']);
    expect(rowCells(table, 1)).toEqual(['1', '3', '6']);
  });

  it('keeps the data table renderable without an x-axis label', () => {
    render(<LineChart data={data} x={x} series={series} ariaLabel="Trend line chart" />);

    const table = screen.getByRole('table');
    expect(table.querySelectorAll('thead th')).toHaveLength(2);
    expect(rowCells(table, 1)).toEqual(['1', '3', '6']);
  });

  it('renders an accessible empty state when there is no data', () => {
    render(
      <LineChart
        data={[]}
        x={x}
        series={series}
        ariaLabel="Empty line chart"
        emptyLabel={DATA_LAB_LABELS.chartNoData}
      />,
    );

    expect(screen.getByRole('img', { name: 'Empty line chart' })).toBeInTheDocument();
    expect(screen.getByText(DATA_LAB_LABELS.chartNoData)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('applies the series and category data from props via setOption', () => {
    render(<LineChart data={data} x={x} series={series} ariaLabel="Trend line chart" />);

    expect(firstSeries()).toMatchObject({
      type: 'line',
      name: 'Value',
      data: [1, 3, 6],
    });
    expect(firstOption().xAxis).toMatchObject({ data: ['A', 'B', 'C'] });
  });

  it('initializes ECharts once per mount on the labelled container and observes it', () => {
    render(<LineChart data={data} x={x} series={series} ariaLabel="Trend line chart" />);

    const container = screen.getByRole('img', { name: 'Trend line chart' });
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock).toHaveBeenCalledWith(container);
    expect(CapturingResizeObserver.instances[0]?.observe).toHaveBeenCalledWith(container);
  });

  it('reuses the instance on re-render, merging updated data instead of re-initializing', () => {
    const { rerender } = render(
      <LineChart data={data} x={x} series={series} ariaLabel="Trend line chart" />,
    );
    const chart = lastChart();

    rerender(
      <LineChart
        data={[...data, { label: 'D', value: 9 }]}
        x={x}
        series={series}
        ariaLabel="Trend line chart"
      />,
    );

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(chart.setOption).toHaveBeenCalledTimes(2);
    const updated = chart.setOption.mock.calls[1][0] as { series: Array<{ data: number[] }> };
    expect(updated.series[0].data).toEqual([1, 3, 6, 9]);
  });

  it('resizes the chart when the container resizes', () => {
    render(<LineChart data={data} x={x} series={series} ariaLabel="Trend line chart" />);
    const chart = lastChart();
    expect(chart.resize).not.toHaveBeenCalled();

    act(() => {
      CapturingResizeObserver.instances[0]?.trigger();
    });

    expect(chart.resize).toHaveBeenCalledTimes(1);
  });

  it('disposes the chart and stops observing on unmount', () => {
    const { unmount } = render(
      <LineChart data={data} x={x} series={series} ariaLabel="Trend line chart" />,
    );
    const chart = lastChart();
    const observer = CapturingResizeObserver.instances[0];

    unmount();

    expect(chart.dispose).toHaveBeenCalledTimes(1);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('never initializes ECharts for the empty state', () => {
    render(<LineChart data={[]} x={x} series={series} ariaLabel="Empty line chart" />);

    expect(initMock).not.toHaveBeenCalled();
  });
});

describe('BarChart', () => {
  it('exposes an accessible label and a legend', () => {
    render(<BarChart data={data} x={x} series={series} ariaLabel="Totals bar chart" />);

    expect(screen.getByRole('img', { name: 'Totals bar chart' })).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: 'Totals bar chart' });
    expect(within(legend).getByText('Value')).toBeInTheDocument();
  });

  it('mirrors the plotted data in a visually hidden table', () => {
    render(
      <BarChart data={data} x={x} xLabel="Month" series={series} ariaLabel="Totals bar chart" />,
    );

    const table = screen.getByRole('table');
    expect(within(table).getByText('Totals bar chart')).toBeInTheDocument();
    expect(Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual([
      'Month',
      'Value',
    ]);
    expect(rowCells(table, 0)).toEqual(['A', 'B', 'C']);
    expect(rowCells(table, 1)).toEqual(['1', '3', '6']);
  });

  it('renders an accessible empty state when there is no data', () => {
    render(
      <BarChart
        data={[]}
        x={x}
        series={series}
        ariaLabel="Empty bar chart"
        emptyLabel={DATA_LAB_LABELS.chartNoData}
      />,
    );

    expect(screen.getByRole('img', { name: 'Empty bar chart' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('applies the grouped bar series from props via setOption', () => {
    render(<BarChart data={data} x={x} series={series} ariaLabel="Totals bar chart" />);

    expect(firstOption().series).toEqual([{ type: 'bar', name: 'Value', data: [1, 3, 6] }]);
  });
});

describe('PieChart', () => {
  it('exposes an accessible label and per-slice percentages', () => {
    render(
      <PieChart
        data={data}
        category={x}
        value={(row) => Number(row.value ?? 0)}
        ariaLabel="Share pie chart"
      />,
    );

    expect(screen.getByRole('img', { name: 'Share pie chart' })).toBeInTheDocument();
    expect(screen.getByText('10%')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  it('carries the exact slice value next to the rounded share', () => {
    render(
      <PieChart
        data={data}
        category={x}
        value={(row) => Number(row.value ?? 0)}
        ariaLabel="Share pie chart"
      />,
    );

    expect(screen.getByText('(1)')).toBeInTheDocument();
    expect(screen.getByText('(3)')).toBeInTheDocument();
    expect(screen.getByText('(6)')).toBeInTheDocument();
  });

  it('renders an accessible empty state when every value is non-positive', () => {
    render(
      <PieChart
        data={[{ label: 'A', value: 0 }]}
        category={x}
        value={(row) => Number(row.value ?? 0)}
        ariaLabel="Empty pie chart"
        emptyLabel={DATA_LAB_LABELS.chartNoData}
      />,
    );

    expect(screen.getByRole('img', { name: 'Empty pie chart' })).toBeInTheDocument();
    expect(screen.getByText(DATA_LAB_LABELS.chartNoData)).toBeInTheDocument();
  });

  it('applies the slice list from props via setOption', () => {
    render(
      <PieChart
        data={data}
        category={x}
        value={(row) => Number(row.value ?? 0)}
        ariaLabel="Share pie chart"
      />,
    );

    expect(firstOption().series).toEqual([
      {
        type: 'pie',
        data: [
          { name: 'A', value: 1 },
          { name: 'B', value: 3 },
          { name: 'C', value: 6 },
        ],
        center: ['50%', '50%'],
        radius: '85%',
        label: { show: false },
        labelLine: { show: false },
        itemStyle: { borderWidth: 2 },
      },
    ]);
  });
});
