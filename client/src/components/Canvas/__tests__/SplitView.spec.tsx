import { render, screen, fireEvent } from '@testing-library/react';
import type { TOptions } from 'i18next';
import { CANVAS_LABELS } from '../labels';
import SplitView from '../SplitView';
import i18n from '~/locales/i18n';

const t = i18n.t.bind(i18n) as (key: string, options?: TOptions) => string;
const L = Object.fromEntries(
  Object.entries(CANVAS_LABELS).map(([name, key]) => [name, t(key)]),
) as Record<keyof typeof CANVAS_LABELS, string>;

const LEFT_TEXT = 'Document body';
const RIGHT_TEXT = 'Assistant body';

function renderSplit() {
  render(
    <SplitView
      left={<p>{LEFT_TEXT}</p>}
      right={<p>{RIGHT_TEXT}</p>}
      leftLabel={L.leftPane}
      rightLabel={L.rightPane}
    />,
  );
  return screen.getByRole('separator', { name: L.splitResize });
}

describe('SplitView', () => {
  it('renders both panes as labelled regions', () => {
    renderSplit();
    expect(screen.getByRole('region', { name: L.leftPane })).toHaveTextContent(LEFT_TEXT);
    expect(screen.getByRole('region', { name: L.rightPane })).toHaveTextContent(RIGHT_TEXT);
  });

  it('resizes with the arrow keys and clamps at the bounds', () => {
    const separator = renderSplit();
    expect(separator).toHaveAttribute('aria-valuenow', '60');

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator).toHaveAttribute('aria-valuenow', '55');

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '60');

    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '20');

    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', '80');
  });

  it('resizes by dragging the divider and stops after release', () => {
    const separator = renderSplit();
    const container = separator.parentElement as HTMLElement;
    jest.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
      right: 1000,
      top: 0,
      bottom: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const pointer = (type: string, clientX: number) =>
      fireEvent(separator, new MouseEvent(type, { bubbles: true, clientX }));

    pointer('pointerdown', 600);
    expect(separator).toHaveAttribute('aria-valuenow', '60');

    pointer('pointermove', 350);
    expect(separator).toHaveAttribute('aria-valuenow', '35');

    pointer('pointermove', 9999);
    expect(separator).toHaveAttribute('aria-valuenow', '80');

    pointer('pointerup', 9999);
    pointer('pointermove', 100);
    expect(separator).toHaveAttribute('aria-valuenow', '80');
  });

  describe('narrow containers', () => {
    class FakeResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(): void {
        this.callback([], this as unknown as ResizeObserver);
      }

      unobserve(): void {}
      disconnect(): void {}
    }

    beforeEach(() => {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    });

    afterEach(() => {
      delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
      jest.restoreAllMocks();
    });

    it('stacks the panes and reports a horizontal separator on a phone', () => {
      // A 60/40 split at phone width left the side panel ~137px wide, where its
      // tabs were clipped; narrow containers now split top/bottom.
      jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
      const separator = renderSplit();

      expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
      const left = screen.getByRole('region', { name: L.leftPane });
      expect(left).toHaveStyle({ height: '60%' });
      expect(left.style.width).toBe('');
    });

    it('keeps the side-by-side split on a wide container', () => {
      jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1280);
      const separator = renderSplit();

      expect(separator).toHaveAttribute('aria-orientation', 'vertical');
      expect(screen.getByRole('region', { name: L.leftPane })).toHaveStyle({ width: '60%' });
    });

    it('accepts the up/down arrows when stacked', () => {
      jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
      const separator = renderSplit();

      fireEvent.keyDown(separator, { key: 'ArrowDown' });
      expect(separator).toHaveAttribute('aria-valuenow', '65');
      fireEvent.keyDown(separator, { key: 'ArrowUp' });
      expect(separator).toHaveAttribute('aria-valuenow', '60');
    });
  });
});
