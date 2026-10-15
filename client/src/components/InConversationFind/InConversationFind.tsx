import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { Search, ChevronDown, ChevronUp, X } from 'lucide-react';
import { IconButton, Spinner } from '@librechat/client';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ACTIVE_HIGHLIGHT_NAME,
  MATCH_HIGHLIGHT_NAME,
  applyHighlights,
  clearHighlights,
  collectMatchRanges,
  findConversationContainer,
  findConversationScope,
  revealRange,
  supportsCustomHighlights,
} from './dom';
import { inConversationFindOpenAtom, inConversationFindQueryAtom } from './state';
import { useLocalize } from '~/hooks';

/**
 * `::highlight()` pseudo-elements cannot be expressed as utility classes, so the
 * two rules ship as a tag while the bar is open. They read only semantic theme
 * variables — no literals — so light/dark/high-contrast themes repaint the
 * highlights along with the rest of the app: an accent wash for every match, and
 * the inverted surface/text pair (which is defined as a pair in every theme) as
 * the active-match block.
 */
const HIGHLIGHT_STYLES = `
::highlight(${MATCH_HIGHLIGHT_NAME}) {
  background-color: rgb(var(--accent-primary) / 0.35);
}
::highlight(${ACTIVE_HIGHLIGHT_NAME}) {
  background-color: rgb(var(--surface-inverted));
  color: rgb(var(--text-inverted));
}
`;

/**
 * Typing settles before the scope is walked: streaming rewrites text nodes
 * continuously, and scanning per keystroke would highlight a moving target.
 */
const QUERY_SCAN_DELAY_MS = 100;
/**
 * The row mount window widens and rows stream while the bar is open; the
 * observer coalesces those bursts into one silent rescan.
 */
const MUTATION_SCAN_DELAY_MS = 150;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * In-conversation find. Mounted once (`Root.tsx`) and driven entirely by the DOM:
 * `⌘/Ctrl+F` opens it only where a conversation is rendered, then matches are
 * highlighted and navigated among with `Enter` / `Shift+Enter`.
 */
export default function InConversationFind() {
  const localize = useLocalize();
  const [open, setOpen] = useAtom(inConversationFindOpenAtom);
  const [query, setQuery] = useAtom(inConversationFindQueryAtom);

  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  /** The query the rendered count belongs to; anything else means "scanning". */
  const [scannedQuery, setScannedQuery] = useState<string | null>(null);
  /** null until the first scan of the open bar has looked for the scope. */
  const [hasScope, setHasScope] = useState<boolean | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const rangesRef = useRef<Range[]>([]);
  const activeIndexRef = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;

  const runScan = useCallback((scanQuery: string, options?: { reveal?: boolean }) => {
    const scope = findConversationScope();
    setHasScope(scope != null);
    const ranges = scope == null ? [] : collectMatchRanges(scope, scanQuery);
    rangesRef.current = ranges;
    setScannedQuery(scanQuery);
    setMatchCount(ranges.length);
    const nextActive = ranges.length === 0 ? 0 : clamp(activeIndexRef.current, 0, ranges.length - 1);
    activeIndexRef.current = nextActive;
    setActiveIndex(nextActive);
    applyHighlights(ranges, nextActive);
    if (options?.reveal === true) {
      revealRange(ranges[nextActive]);
    }
  }, []);

  const goTo = useCallback((step: number) => {
    const count = rangesRef.current.length;
    if (count === 0) {
      return;
    }
    const next = (activeIndexRef.current + step + count) % count;
    activeIndexRef.current = next;
    setActiveIndex(next);
    applyHighlights(rangesRef.current, next);
    revealRange(rangesRef.current[next]);
  }, []);

  const closeAndClear = useCallback(() => {
    setQuery('');
    setOpen(false);
  }, [setOpen, setQuery]);

  /** Open on `⌘/Ctrl+F` only inside a conversation, so the browser keeps its own
   *  find everywhere else. */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'f'
      ) {
        if (findConversationContainer() == null) {
          return;
        }
        event.preventDefault();
        if (open) {
          inputRef.current?.focus();
          return;
        }
        openerRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, setOpen]);

  /** Open/close lifecycle: focus handoff, and a teardown on the same commit that
   *  hides the bar so a reopen never paints a stale count or stale ranges. */
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      return;
    }
    clearHighlights();
    rangesRef.current = [];
    activeIndexRef.current = 0;
    setMatchCount(0);
    setActiveIndex(0);
    setScannedQuery(null);
    setHasScope(null);
    const opener = openerRef.current;
    openerRef.current = null;
    /** The opener can be gone by now (its row unmounted); focusing it would drop
     *  focus to the body. */
    if (opener?.isConnected) {
      opener.focus();
    }
  }, [open]);

  useEffect(() => () => clearHighlights(), []);

  /** Query-driven scan. The count is not rendered until this runs, which is what
   *  the loading state reports. */
  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(
      () => runScan(query, { reveal: true }),
      query === '' ? 0 : QUERY_SCAN_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [open, query, runScan]);

  /** The conversation DOM keeps moving while the bar is open (streaming text,
   *  the widening row mount window, sibling switches). Rescans are silent — they
   *  refresh the count without stealing the active match or the scroll position. */
  useEffect(() => {
    if (!open) {
      return;
    }
    let rescanTimer: number | null = null;
    const scheduleRescan = () => {
      if (rescanTimer != null) {
        window.clearTimeout(rescanTimer);
      }
      rescanTimer = window.setTimeout(() => {
        rescanTimer = null;
        runScan(queryRef.current);
      }, MUTATION_SCAN_DELAY_MS);
    };
    const observer = new MutationObserver((mutations) => {
      const container = findConversationContainer();
      if (container == null) {
        /** The conversation unmounted (route change); a bar over a conversation
         *  that is no longer on screen has nothing to search. */
        setOpen(false);
        return;
      }
      /** The search scope wraps the message rows and is often a *sibling* of the
       *  container marker, so containment must be checked against both. */
      const scope = findConversationScope();
      const within = (node: Node): boolean =>
        node === container ||
        node === scope ||
        container.contains(node) ||
        (scope != null && scope.contains(node));
      const touchesConversation = mutations.some((mutation) => {
        if (within(mutation.target)) {
          return true;
        }
        return [...mutation.addedNodes, ...mutation.removedNodes].some(
          (node) =>
            within(node) ||
            (node.nodeType === Node.ELEMENT_NODE &&
              ((node as Element).contains(container) ||
                (scope != null && (node as Element).contains(scope)))),
        );
      });
      if (touchesConversation) {
        scheduleRescan();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (rescanTimer != null) {
        window.clearTimeout(rescanTimer);
      }
    };
  }, [open, runScan, setOpen]);

  const handleInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) {
        return;
      }
      switch (event.key) {
        case 'Enter': {
          event.preventDefault();
          goTo(event.shiftKey ? -1 : 1);
          break;
        }
        case 'Escape': {
          event.preventDefault();
          event.stopPropagation();
          closeAndClear();
          break;
        }
        default:
          break;
      }
    },
    [closeAndClear, goTo],
  );

  /** Escape must close the bar from its buttons too, not just the input. */
  const handleBarKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closeAndClear();
    },
    [closeAndClear],
  );

  if (!open) {
    return null;
  }

  const pending = query !== '' && scannedQuery !== query;
  const showEmpty = hasScope === false;
  const showNoResults = !showEmpty && !pending && query !== '' && matchCount === 0;
  const showCount = !showEmpty && !pending && query !== '' && matchCount > 0;

  return (
    <>
      {supportsCustomHighlights() && (
        <style dangerouslySetInnerHTML={{ __html: HIGHLIGHT_STYLES }} />
      )}
      <div
        role="search"
        aria-label={localize('com_ui_find_in_conversation')}
        onKeyDown={handleBarKeyDown}
        className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-lg border border-border-light bg-surface-primary p-2 shadow-lg"
      >
        <Search className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            activeIndexRef.current = 0;
            setActiveIndex(0);
          }}
          onKeyDown={handleInputKeyDown}
          aria-label={localize('com_ui_find_in_conversation')}
          aria-describedby="in-conversation-find-limitation"
          aria-keyshortcuts="Control+F Meta+F"
          autoComplete="off"
          spellCheck={false}
          placeholder={localize('com_ui_find_placeholder')}
          className="h-8 w-52 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
        />
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="min-w-16 text-xs text-text-secondary"
        >
          {showEmpty && <span>{localize('com_ui_find_empty')}</span>}
          {!showEmpty && pending && (
            <span className="inline-flex items-center gap-1">
              <Spinner className="size-3" />
              {localize('com_ui_find_loading')}
            </span>
          )}
          {showNoResults && <span>{localize('com_ui_find_no_results')}</span>}
          {showCount && (
            <span>{localize('com_ui_find_count', { 0: activeIndex + 1, 1: matchCount })}</span>
          )}
        </div>
        <IconButton
          variant="ghost"
          size="sm"
          shape="round"
          label={localize('com_ui_find_previous')}
          disabled={matchCount === 0}
          onClick={() => goTo(-1)}
        >
          <ChevronUp className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton
          variant="ghost"
          size="sm"
          shape="round"
          label={localize('com_ui_find_next')}
          disabled={matchCount === 0}
          onClick={() => goTo(1)}
        >
          <ChevronDown className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton
          variant="ghost"
          size="sm"
          shape="round"
          label={localize('com_ui_find_close')}
          onClick={closeAndClear}
        >
          <X className="size-4" aria-hidden="true" />
        </IconButton>
        <span id="in-conversation-find-limitation" className="sr-only">
          {localize('com_ui_find_rendered_only')}
        </span>
      </div>
    </>
  );
}
