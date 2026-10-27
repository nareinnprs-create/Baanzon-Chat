import { render, screen, within } from '@testing-library/react';
import type { DataRow } from '../types';
import LineChart from '../charts/LineChart';
import { DATA_LAB_LABELS } from '../labels';
import BarChart from '../charts/BarChart';
import PieChart from '../charts/PieChart';

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
});
