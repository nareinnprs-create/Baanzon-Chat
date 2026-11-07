import React from 'react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { act, render, renderHook, screen } from '@testing-library/react';
import type { TAuroraPulseState } from '../atoms';
import { AURORA_PULSE_STATES, auroraPulseAtom, useSetAuroraPulse } from '../atoms';
import AuroraPulse from '../AuroraPulse';

/**
 * The en copy is asserted verbatim so a translation.json drift cannot silently
 * strip the pulse of its accessible name. `motion-safe:` is asserted as the
 * reduced-motion seam itself: the Tailwind variant gates the animation behind
 * `@media (prefers-reduced-motion: no-preference)`, which jsdom never runs —
 * the suite's matchMedia polyfill (test/setupTests.js) answers `matches:
 * false` for every query, so what can be verified here is that every
 * continuous animation ships with the gate attached.
 */
const PULSE_LABELS: Record<TAuroraPulseState, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  searching: 'Searching',
  reading: 'Reading',
  creating: 'Creating',
  voice: 'Voice active',
  completed: 'Completed',
  attention: 'Needs your attention',
};

/** Blueprint §63.9 states whose motion is genuinely continuous. */
const MOTION_STATES: readonly TAuroraPulseState[] = [
  'thinking',
  'searching',
  'reading',
  'creating',
  'voice',
  'attention',
];

/** States that must stay still — nothing is running. */
const STILL_STATES: readonly TAuroraPulseState[] = ['idle', 'completed'];

function renderWithStore(ui: React.ReactNode) {
  const store = createStore();
  return { store, ...render(<JotaiProvider store={store}>{ui}</JotaiProvider>) };
}

describe('AuroraPulse', () => {
  it.each(AURORA_PULSE_STATES)(
    'renders the %s state with its blueprint role and localized accessible name',
    (state) => {
      render(<AuroraPulse state={state} />);
      const pulse = screen.getByTestId('aurora-pulse');
      expect(pulse).toHaveAttribute('role', 'status');
      expect(pulse).toHaveAttribute('data-state', state);
      expect(pulse).toHaveAttribute('aria-label', PULSE_LABELS[state]);
    },
  );

  it.each(MOTION_STATES)(
    'gates the %s animation behind motion-safe so reduced motion falls still',
    (state) => {
      render(<AuroraPulse state={state} />);
      const dot = screen.getByTestId('aurora-pulse').firstElementChild as HTMLElement;
      expect(dot).toHaveClass('motion-safe:animate-pulse');
      expect(dot.className).toMatch(/(^|\s)motion-safe:animate-pulse(\s|$)/);
    },
  );

  it.each(STILL_STATES)('keeps the %s mark still — motion must be truthful', (state) => {
    render(<AuroraPulse state={state} />);
    const dot = screen.getByTestId('aurora-pulse').firstElementChild as HTMLElement;
    expect(dot.className).not.toMatch(/animate-/);
  });

  it('marks working activity with the status-info role and idle with the neutral surface', () => {
    const { rerender } = render(<AuroraPulse state="idle" />);
    let dot = screen.getByTestId('aurora-pulse').firstElementChild as HTMLElement;
    expect(dot).toHaveClass('bg-surface-tertiary');

    rerender(<AuroraPulse state="thinking" />);
    dot = screen.getByTestId('aurora-pulse').firstElementChild as HTMLElement;
    expect(dot).toHaveClass('bg-status-info');

    rerender(<AuroraPulse state="completed" />);
    dot = screen.getByTestId('aurora-pulse').firstElementChild as HTMLElement;
    expect(dot).toHaveClass('bg-status-success');

    rerender(<AuroraPulse state="attention" />);
    dot = screen.getByTestId('aurora-pulse').firstElementChild as HTMLElement;
    expect(dot).toHaveClass('bg-status-warning');
  });

  it('defaults to the honest idle state and follows the feature-owned setter', () => {
    const { store } = renderWithStore(<AuroraPulse />);
    expect(screen.getByTestId('aurora-pulse')).toHaveAttribute('data-state', 'idle');

    const { result } = renderHook(() => useSetAuroraPulse(), {
      wrapper: ({ children }) => <JotaiProvider store={store}>{children}</JotaiProvider>,
    });
    act(() => result.current('thinking'));

    expect(screen.getByTestId('aurora-pulse')).toHaveAttribute('data-state', 'thinking');
    expect(screen.getByTestId('aurora-pulse')).toHaveAttribute('aria-label', PULSE_LABELS.thinking);
    expect(store.get(auroraPulseAtom)).toBe('thinking');
  });

  it('lets an explicit state prop override the shared atom without writing it', () => {
    const { store } = renderWithStore(<AuroraPulse state="attention" />);
    expect(screen.getByTestId('aurora-pulse')).toHaveAttribute('data-state', 'attention');
    expect(store.get(auroraPulseAtom)).toBe('idle');
  });

  it('shows the localized state text when withLabel is set', () => {
    render(<AuroraPulse state="voice" withLabel />);
    const pulse = screen.getByTestId('aurora-pulse');
    expect(pulse).toHaveTextContent(PULSE_LABELS.voice);
  });

  it('keeps the accessible name even when the label is hidden', () => {
    render(<AuroraPulse state="searching" />);
    const pulse = screen.getByTestId('aurora-pulse');
    expect(pulse).toHaveAttribute('aria-label', PULSE_LABELS.searching);
    expect(pulse.textContent).toBe('');
  });

  it('declares every state in the contract order and stays inside it', () => {
    expect(AURORA_PULSE_STATES).toEqual([
      'idle',
      'thinking',
      'searching',
      'reading',
      'creating',
      'voice',
      'completed',
      'attention',
    ]);
  });
});
