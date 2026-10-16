import { Provider } from 'jotai';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { DataTable } from '../types';
import { DATA_LAB_LABELS, formatDataLabLabel } from '../labels';
import DataLabView from '../DataLabView';

const dataset: DataTable = {
  columns: [
    { key: 'name', label: 'Name', type: 'string' },
    { key: 'value', label: 'Value', type: 'number' },
  ],
  rows: [
    { name: 'A', value: 1 },
    { name: 'B', value: 2 },
    { name: 'C', value: 3 },
  ],
};

function renderView(ui: ReactElement) {
  return render(<Provider>{ui}</Provider>);
}

describe('DataLabView', () => {
  it('shows a loading state', () => {
    renderView(<DataLabView isLoading />);

    expect(screen.getByText(DATA_LAB_LABELS.loading)).toBeInTheDocument();
  });

  it('shows an empty state when there is no data', () => {
    renderView(<DataLabView dataset={{ columns: [], rows: [] }} />);

    expect(screen.getByText(DATA_LAB_LABELS.emptyTitle)).toBeInTheDocument();
  });

  it('renders the chart, analysis actions and table on success', () => {
    renderView(<DataLabView dataset={dataset} />);

    expect(
      screen.getByRole('img', {
        name: formatDataLabLabel('chartAria', { 0: DATA_LAB_LABELS.chartLine }),
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('group', { name: DATA_LAB_LABELS.actions })).toBeInTheDocument();
    expect(screen.getByText(DATA_LAB_LABELS.tableCaption)).toBeInTheDocument();
  });

  it('switches the active chart', () => {
    renderView(<DataLabView dataset={dataset} />);

    fireEvent.click(screen.getByRole('button', { name: DATA_LAB_LABELS.chartBar }));

    expect(
      screen.getByRole('img', {
        name: formatDataLabLabel('chartAria', { 0: DATA_LAB_LABELS.chartBar }),
      }),
    ).toBeInTheDocument();
  });

  it('surfaces a failure with a retry affordance', () => {
    const onRetry = jest.fn();
    renderView(<DataLabView error="Boom" onRetry={onRetry} />);

    expect(screen.getByText(DATA_LAB_LABELS.failureTitle)).toBeInTheDocument();
    expect(screen.getByText('Boom')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: DATA_LAB_LABELS.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('loads a dataset from an injected loader and retries on demand', async () => {
    const loadData = jest.fn().mockResolvedValue(dataset);
    renderView(<DataLabView loadData={loadData} />);

    await waitFor(() => expect(loadData).toHaveBeenCalledTimes(1));
    await screen.findByRole('img', {
      name: formatDataLabLabel('chartAria', { 0: DATA_LAB_LABELS.chartLine }),
    });
  });
});
