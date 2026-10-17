import { render, screen, fireEvent } from '@testing-library/react';
import { CANVAS_LABELS as L } from '../labels';
import SplitView from '../SplitView';

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
});
