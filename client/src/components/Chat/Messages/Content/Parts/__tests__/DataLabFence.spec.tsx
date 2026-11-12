import React from 'react';
import * as echartsCore from 'echarts/core';
import { render, screen } from '@testing-library/react';

jest.mock('echarts/core', () => ({
  init: jest.fn(() => ({
    setOption: jest.fn(),
    resize: jest.fn(),
    dispose: jest.fn(),
  })),
  use: jest.fn(),
}));
jest.mock('echarts/charts', () => ({
  BarChart: {},
  LineChart: {},
  PieChart: {},
}));
jest.mock('echarts/components', () => ({
  GridComponent: {},
  TooltipComponent: {},
  LegendComponent: {},
}));
jest.mock('echarts/renderers', () => ({
  SVGRenderer: {},
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

import DataLabFence from '../DataLabFence';

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
});

const fallback = <div data-testid="dlf-fallback" />;

function baseProps(lang: string, content: string) {
  return {
    lang,
    content,
    codeChildren: content,
    allowExecution: false,
    fallbackOverride: undefined,
  };
}

describe('DataLabFence', () => {
  it('renders a chart fence as the chart primitive instead of the code block', () => {
    const content = JSON.stringify({
      kind: 'bar',
      title: 'Revenue',
      data: [
        { label: 'Q1', value: 12 },
        { label: 'Q2', value: 18 },
      ],
    });
    render(<DataLabFence {...baseProps('chart', content)} fallback={fallback} />);
    expect(screen.getByRole('img', { name: 'Revenue' })).toBeInTheDocument();
    expect(screen.queryByTestId('dlf-fallback')).not.toBeInTheDocument();
    expect(echartsCore.init).toHaveBeenCalled();
  });

  it('plots every extra numeric key as its own series', () => {
    const content = JSON.stringify({
      data: [{ label: 'Mon', value: 3, forecast: 5 }],
    });
    const { container } = render(
      <DataLabFence {...baseProps('chart', content)} fallback={fallback} />,
    );
    const initMock = jest.mocked(echartsCore.init);
    const chart = initMock.mock.results.at(-1)?.value;
    if (!chart) {
      throw new Error('chart not initialized');
    }
    const series = chart.setOption.mock.calls.at(-1)[0].series;
    expect(series).toHaveLength(2);
    expect(container).toBeInTheDocument();
  });

  it('falls back to the code block when chart JSON is invalid or has no numbers', () => {
    const { rerender } = render(
      <DataLabFence {...baseProps('chart', '{"kind": "bar", "data": [')} fallback={fallback} />,
    );
    expect(screen.getByTestId('dlf-fallback')).toBeInTheDocument();

    rerender(
      <DataLabFence
        {...baseProps('chart', JSON.stringify({ data: [{ label: 'a' }] }))}
        fallback={fallback}
      />,
    );
    expect(screen.getByTestId('dlf-fallback')).toBeInTheDocument();
  });

  it('renders a table fence as the sortable table', () => {
    const content = 'name,score\nalpha,9\nbeta,7';
    render(<DataLabFence {...baseProps('table', content)} fallback={fallback} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.queryByTestId('dlf-fallback')).not.toBeInTheDocument();
  });

  it('falls back to the code block for an empty table', () => {
    render(<DataLabFence {...baseProps('table', 'name,score')} fallback={fallback} />);
    expect(screen.getByTestId('dlf-fallback')).toBeInTheDocument();
  });

  it('passes unknown languages through as the fallback code block', () => {
    render(<DataLabFence {...baseProps('python', 'print(1)')} fallback={fallback} />);
    expect(screen.getByTestId('dlf-fallback')).toBeInTheDocument();
  });
});
