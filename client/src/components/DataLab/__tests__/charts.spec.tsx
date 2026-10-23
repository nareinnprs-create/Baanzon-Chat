import { render, screen } from '@testing-library/react';
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

describe('LineChart', () => {
  it('exposes an accessible label and a legend', () => {
    render(<LineChart data={data} x={x} series={series} ariaLabel="Trend line chart" />);

    expect(screen.getByRole('img', { name: 'Trend line chart' })).toBeInTheDocument();
    expect(screen.getByText('Value')).toBeInTheDocument();
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
  });
});

describe('BarChart', () => {
  it('exposes an accessible label and a legend', () => {
    render(<BarChart data={data} x={x} series={series} ariaLabel="Totals bar chart" />);

    expect(screen.getByRole('img', { name: 'Totals bar chart' })).toBeInTheDocument();
    expect(screen.getByText('Value')).toBeInTheDocument();
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
});
