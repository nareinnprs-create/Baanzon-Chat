import { render, screen, within, fireEvent } from '@testing-library/react';
import type { DataTable } from '../types';
import { DATA_LAB_LABELS, formatDataLabLabel } from '../labels';
import DataLabTable from '../DataLabTable';

const table: DataTable = {
  columns: [
    { key: 'name', label: 'Name', type: 'string' },
    { key: 'score', label: 'Score', type: 'number' },
  ],
  rows: [
    { name: 'b', score: 2 },
    { name: 'a', score: 10 },
    { name: 'c', score: 1 },
  ],
};

function cellValues(columnIndex: number): Array<string | null> {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[columnIndex].textContent);
}

describe('DataLabTable', () => {
  it('renders every row in source order when unsorted', () => {
    render(<DataLabTable table={table} sort={null} onSortChange={() => {}} />);

    expect(cellValues(0)).toEqual(['b', 'a', 'c']);
  });

  it('orders rows by the active sort', () => {
    render(
      <DataLabTable
        table={table}
        sort={{ key: 'score', direction: 'asc' }}
        onSortChange={() => {}}
      />,
    );

    expect(cellValues(0)).toEqual(['c', 'b', 'a']);
    expect(screen.getAllByRole('columnheader')[1]).toHaveAttribute('aria-sort', 'ascending');
  });

  it('requests the next sort state when a header is clicked', () => {
    const onSortChange = jest.fn();
    render(<DataLabTable table={table} sort={null} onSortChange={onSortChange} />);

    fireEvent.click(
      screen.getByRole('button', { name: formatDataLabLabel('sortBy', { 0: 'Score' }) }),
    );

    expect(onSortChange).toHaveBeenCalledWith({ key: 'score', direction: 'asc' });
  });

  it('cycles an active column from ascending to descending', () => {
    const onSortChange = jest.fn();
    render(
      <DataLabTable
        table={table}
        sort={{ key: 'score', direction: 'asc' }}
        onSortChange={onSortChange}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: formatDataLabLabel('sortBy', { 0: 'Score' }) }),
    );

    expect(onSortChange).toHaveBeenCalledWith({ key: 'score', direction: 'desc' });
  });

  it('shows an empty state when there are no rows', () => {
    render(
      <DataLabTable
        table={{ columns: table.columns, rows: [] }}
        sort={null}
        onSortChange={() => {}}
      />,
    );

    expect(screen.getByText(DATA_LAB_LABELS.tableEmpty)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
