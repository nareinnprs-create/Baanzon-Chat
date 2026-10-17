import { useCallback, useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { CANVAS_LABELS as L } from './labels';
import { clamp } from '~/utils/canvas';
import { cn } from '~/utils';

export type SplitViewProps = {
  /** Content of the leading pane. */
  left: ReactNode;
  /** Content of the trailing pane. */
  right: ReactNode;
  /** Accessible name for the leading pane. */
  leftLabel: string;
  /** Accessible name for the trailing pane. */
  rightLabel: string;
  /** Initial width of the leading pane as a percentage. */
  initialLeftPercent?: number;
  minLeftPercent?: number;
  maxLeftPercent?: number;
  /** Percentage moved by an arrow key on the divider. */
  stepPercent?: number;
  className?: string;
};

/**
 * A resizable two-pane layout with a draggable, keyboard-operable divider.
 *
 * The divider is a focusable `separator` range widget: left/right arrows move
 * it by `stepPercent`, Home/End jump to the bounds, and `aria-valuenow` reports
 * the leading pane's width. The pane split is genuine layout, so it is
 * expressed with an inline percentage width; no custom CSS is introduced.
 */
export default function SplitView({
  left,
  right,
  leftLabel,
  rightLabel,
  initialLeftPercent = 60,
  minLeftPercent = 20,
  maxLeftPercent = 80,
  stepPercent = 5,
  className,
}: SplitViewProps) {
  const baseId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [leftPercent, setLeftPercent] = useState(() =>
    clamp(initialLeftPercent, minLeftPercent, maxLeftPercent),
  );

  const setFromClientX = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) {
        return;
      }
      const percent = ((clientX - rect.left) / rect.width) * 100;
      setLeftPercent(clamp(percent, minLeftPercent, maxLeftPercent));
    },
    [maxLeftPercent, minLeftPercent],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      const target = event.currentTarget;
      if (typeof target.setPointerCapture === 'function') {
        target.setPointerCapture(event.pointerId);
      }
      setFromClientX(event.clientX);
    },
    [setFromClientX],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) {
        return;
      }
      setFromClientX(event.clientX);
    },
    [setFromClientX],
  );

  const handlePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    const target = event.currentTarget;
    if (
      typeof target.hasPointerCapture === 'function' &&
      typeof target.releasePointerCapture === 'function' &&
      target.hasPointerCapture(event.pointerId)
    ) {
      target.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      let next: number | null = null;
      if (event.key === 'ArrowLeft') {
        next = leftPercent - stepPercent;
      } else if (event.key === 'ArrowRight') {
        next = leftPercent + stepPercent;
      } else if (event.key === 'Home') {
        next = minLeftPercent;
      } else if (event.key === 'End') {
        next = maxLeftPercent;
      }
      if (next == null) {
        return;
      }
      event.preventDefault();
      setLeftPercent(clamp(next, minLeftPercent, maxLeftPercent));
    },
    [leftPercent, maxLeftPercent, minLeftPercent, stepPercent],
  );

  return (
    <div ref={containerRef} className={cn('flex h-full min-h-0 w-full overflow-hidden', className)}>
      <section
        id={`${baseId}-left`}
        aria-label={leftLabel}
        className="flex min-w-0 flex-col overflow-hidden"
        style={{ width: `${leftPercent}%` }}
      >
        {left}
      </section>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={L.splitResize}
        aria-valuenow={Math.round(leftPercent)}
        aria-valuemin={minLeftPercent}
        aria-valuemax={maxLeftPercent}
        aria-controls={`${baseId}-left ${baseId}-right`}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
        className="w-1.5 shrink-0 cursor-col-resize touch-none bg-border-light transition-colors hover:bg-surface-active-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
      />

      <section
        id={`${baseId}-right`}
        aria-label={rightLabel}
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
      >
        {right}
      </section>
    </div>
  );
}
