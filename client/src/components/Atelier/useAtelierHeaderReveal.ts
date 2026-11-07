import { useEffect, useState } from 'react';

/**
 * True while the user is scrolling UP inside the conversation, false while
 * scrolling down (or at rest). Drives the atelier breadcrumb strip: the chat
 * header stays hidden while reading and slides in when the user reaches back.
 *
 * The transcript scroller publishes nothing, so this listens to `scroll` in
 * the capture phase at the document level and qualifies the scrolling element
 * itself — a vertical scroller that contains the transcript anchor
 * (`#messages-end`). The qualification runs once per element (identity check),
 * not per event, so a long conversation never re-queries the DOM per frame.
 * Scrolling a sidebar list or a dialog never moves the strip.
 *
 * Inert unless `enabled` (i.e. outside atelier mode).
 */
export default function useAtelierHeaderReveal(enabled: boolean): boolean {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let lastScroller: Element | null = null;
    let lastTop = 0;
    let rafId: number | null = null;

    const flush = () => {
      rafId = null;
      if (lastScroller == null) {
        return;
      }
      const top = lastScroller.scrollTop;
      if (top < lastTop && top > 0) {
        setRevealed(true);
      } else if (top > lastTop || top === 0) {
        setRevealed(false);
      }
      lastTop = top;
    };

    const handleScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target !== lastScroller) {
        if (target.scrollHeight <= target.clientHeight) {
          return;
        }
        if (target.querySelector('#messages-end') == null) {
          return;
        }
        lastScroller = target;
        lastTop = target.scrollTop;
        return;
      }
      if (rafId == null) {
        rafId = requestAnimationFrame(flush);
      }
    };

    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('scroll', handleScroll, true);
      if (rafId != null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [enabled]);

  return revealed;
}
