import { Provider } from 'jotai';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { TOptions } from 'i18next';
import type { DataTable } from '../types';
import { DATA_LAB_LABELS } from '../labels';
import DataLabView from '../DataLabView';
import i18n from '~/locales/i18n';

const t = i18n.t.bind(i18n) as (key: string, options?: TOptions) => string;
const L = Object.fromEntries(
  Object.entries(DATA_LAB_LABELS).map(([name, key]) => [name, t(key)]),
) as Record<keyof typeof DATA_LAB_LABELS, string>;
const fmt = (name: keyof typeof DATA_LAB_LABELS, values?: TOptions) =>
  t(DATA_LAB_LABELS[name], values);

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

    expect(screen.getByText(L.loading)).toBeInTheDocument();
  });

  it('shows an empty state when there is no data', () => {
    renderView(<DataLabView dataset={{ columns: [], rows: [] }} />);

    expect(screen.getByText(L.emptyTitle)).toBeInTheDocument();
  });

  it('renders the chart, analysis actions and table on success', () => {
    renderView(<DataLabView dataset={dataset} />);

    expect(
      screen.getByRole('img', {
        name: fmt('chartAria', { 0: L.chartLine }),
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('group', { name: L.actions })).toBeInTheDocument();
    expect(screen.getByText(L.tableCaption)).toBeInTheDocument();
  });

  it('switches the active chart', () => {
    renderView(<DataLabView dataset={dataset} />);

    fireEvent.click(screen.getByRole('button', { name: L.chartBar }));

    expect(
      screen.getByRole('img', {
        name: fmt('chartAria', { 0: L.chartBar }),
      }),
    ).toBeInTheDocument();
  });

  it('surfaces a failure with a retry affordance', () => {
    const onRetry = jest.fn();
    renderView(<DataLabView error="Boom" onRetry={onRetry} />);

    expect(screen.getByText(L.failureTitle)).toBeInTheDocument();
    expect(screen.getByText('Boom')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: L.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('loads a dataset from an injected loader and retries on demand', async () => {
    const loadData = jest.fn().mockResolvedValue(dataset);
    renderView(<DataLabView loadData={loadData} />);

    await waitFor(() => expect(loadData).toHaveBeenCalledTimes(1));
    await screen.findByRole('img', {
      name: fmt('chartAria', { 0: L.chartLine }),
    });
  });
});
