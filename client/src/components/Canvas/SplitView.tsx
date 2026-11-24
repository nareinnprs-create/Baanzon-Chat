import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { CANVAS_LABELS as L } from './labels';
import { clamp } from '~/utils/canvas';
import { useLocalize } from '~/hooks';
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
 * Width below which the panes stack. A 60/40 split at phone width leaves the
 * side panel ~137px wide, which clipped its tabs and made both panes unusable,
 * so narrow containers get a vertical split instead.
 */
const STACK_BELOW_PX = 768;

/**
 * A resizable two-pane layout with a draggable, keyboard-operable divider.
 *
 * Wide containers split left/right; narrow ones (phones, narrow PWA windows)
 * stack the panes top/bottom. The divider is a focusable `separator` range
 * widget: arrows move it by `stepPercent`, Home/End jump to the bounds, and
 * `aria-valuenow` reports the leading pane's size. The split is genuine layout,
 * so it is expressed with an inline percentage; no custom CSS is introduced.
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
  const localize = useLocalize();
  const baseId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [leftPercent, setLeftPercent] = useState(() =>
    clamp(initialLeftPercent, minLeftPercent, maxLeftPercent),
  );
  const [stacked, setStacked] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const measure = () =>
      setStacked(element.clientWidth > 0 && element.clientWidth < STACK_BELOW_PX);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  const setFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const size = stacked ? rect.height : rect.width;
      if (size === 0) {
        return;
      }
      const offset = stacked ? clientY - rect.top : clientX - rect.left;
      setLeftPercent(clamp((offset / size) * 100, minLeftPercent, maxLeftPercent));
    },
    [maxLeftPercent, minLeftPercent, stacked],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      const target = event.currentTarget;
      if (typeof target.setPointerCapture === 'function') {
        target.setPointerCapture(event.pointerId);
      }
      setFromPointer(event.clientX, event.clientY);
    },
    [setFromPointer],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) {
        return;
      }
      setFromPointer(event.clientX, event.clientY);
    },
    [setFromPointer],
  );

  const endDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
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
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        next = leftPercent - stepPercent;
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
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
    <div
      ref={containerRef}
      className={cn('flex h-full min-h-0 w-full overflow-hidden', stacked && 'flex-col', className)}
    >
      <section
        id={`${baseId}-left`}
        aria-label={leftLabel}
        className="flex min-h-0 min-w-0 flex-col overflow-hidden"
        style={stacked ? { height: `${leftPercent}%` } : { width: `${leftPercent}%` }}
      >
        {left}
      </section>

      <div
        role="separator"
        aria-orientation={stacked ? 'horizontal' : 'vertical'}
        aria-label={localize(L.splitResize)}
        aria-valuenow={Math.round(leftPercent)}
        aria-valuemin={minLeftPercent}
        aria-valuemax={maxLeftPercent}
        aria-controls={`${baseId}-left ${baseId}-right`}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={() => {
          draggingRef.current = false;
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          'relative shrink-0 touch-none bg-border-light transition-colors hover:bg-surface-active-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary',
          // A 6px bar is unhittable on a phone: the pseudo-element widens the
          // pointer target to 22px without changing the visual thickness.
          "before:absolute before:-inset-2 before:content-['']",
          stacked ? 'h-1.5 w-full cursor-row-resize' : 'w-1.5 cursor-col-resize',
        )}
      />

      <section
        id={`${baseId}-right`}
        aria-label={rightLabel}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        {right}
      </section>
    </div>
  );
}
