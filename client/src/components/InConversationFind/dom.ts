/**
 * The DOM contract the find feature borrows from `MessagesView`, so the bar can
 * mount globally (`Root.tsx`) without reaching into the message tree or adding
 * per-message props:
 *
 * - `#messages-end` marks "a conversation is on screen". Its presence gates the
 *   `⌘/Ctrl+F` interception, so the browser's own find is left alone on routes
 *   with no conversation (and while `ChatView` still shows its loader, which
 *   replaces `MessagesView` entirely).
 * - `[data-testid="screenshot-target"]` wraps the rendered message rows, so it
 *   is the search scope.
 *
 * VIRTUALIZATION LIMITATION: `MessagesView` runs a progressive row mount window
 * (`useProgressiveRowMount` / `RowMountProvider` in `MultiMessage`), so rows
 * outside that window are not in the DOM at all. Matches are therefore collected
 * from RENDERED nodes only — the counter can under-report a long conversation
 * until the window widens (which it does as the reader scrolls; the mutation
 * observer rescans). Wrapping matches in `<mark>` was rejected too: React owns
 * the streamed Markdown text nodes, and replacing them breaks reconciliation.
 */
export const CONVERSATION_CONTAINER_ID = 'messages-end';
export const CONVERSATION_SCOPE_SELECTOR = '[data-testid="screenshot-target"]';

/** CSS `::highlight()` names: every match, and the active match. */
export const MATCH_HIGHLIGHT_NAME = 'in-conversation-find-match';
export const ACTIVE_HIGHLIGHT_NAME = 'in-conversation-find-active';

const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'OPTION']);

export function findConversationContainer(doc: Document = document): HTMLElement | null {
  return doc.getElementById(CONVERSATION_CONTAINER_ID);
}

export function findConversationScope(doc: Document = document): HTMLElement | null {
  return doc.querySelector<HTMLElement>(CONVERSATION_SCOPE_SELECTOR);
}

/**
 * Whether the CSS Custom Highlight API exists. It paints ranges without touching
 * the DOM; Firefox < 140 and jsdom lack it, and the bar then still counts and
 * navigates, only without the visual highlight.
 */
export function supportsCustomHighlights(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every occurrence of `query` (case-insensitive, literal) in the rendered
 * conversation scope, in document order. Matches that span two text nodes (a
 * word split by inline formatting) are not found; this is a DOM-level find, not
 * a rendered-text find.
 */
export function collectMatchRanges(root: HTMLElement, query: string): Range[] {
  if (query === '') {
    return [];
  }
  const ranges: Range[] = [];
  const doc = root.ownerDocument;
  const pattern = new RegExp(escapeRegExp(query), 'gi');
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (parent == null || SKIPPED_TAGS.has(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      /** Collapsed/`hidden` subtrees hold text that is not on screen; painting a
       *  highlight over it would point at nothing. `checkVisibility` also covers
       *  `display:none` ancestors in real browsers; jsdom has no layout engine,
       *  so it falls back to the explicit checks above and below. */
      if (parent.closest('[hidden]') != null) {
        return NodeFilter.FILTER_REJECT;
      }
      if (
        typeof parent.checkVisibility === 'function' &&
        !parent.checkVisibility({ checkVisibilityCSS: true })
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      const text = node.nodeValue;
      if (text == null || text.toLowerCase().indexOf(query.toLowerCase()) === -1) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node = walker.nextNode();
  while (node != null) {
    const text = node.nodeValue ?? '';
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const range = doc.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + match[0].length);
      ranges.push(range);
    }
    node = walker.nextNode();
  }
  pattern.lastIndex = 0;
  return ranges;
}

export function applyHighlights(ranges: Range[], activeIndex: number): void {
  if (!supportsCustomHighlights()) {
    return;
  }
  const active = activeIndex >= 0 && activeIndex < ranges.length ? ranges[activeIndex] : undefined;
  CSS.highlights.set(MATCH_HIGHLIGHT_NAME, new Highlight(...ranges));
  if (active != null) {
    CSS.highlights.set(ACTIVE_HIGHLIGHT_NAME, new Highlight(active));
  } else {
    CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME);
  }
}

export function clearHighlights(): void {
  if (!supportsCustomHighlights()) {
    return;
  }
  CSS.highlights.delete(MATCH_HIGHLIGHT_NAME);
  CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME);
}

/**
 * Bring a match into view. `scrollIntoView` resolves the nearest scrollable
 * ancestor (the message scroller), so no container reference is needed. jsdom
 * has no layout and no `scrollIntoView`, hence the optional call.
 */
export function revealRange(range: Range | undefined): void {
  if (range == null) {
    return;
  }
  const node = range.startContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  element?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
}
