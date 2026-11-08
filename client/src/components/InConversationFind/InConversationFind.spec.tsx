import { createStore, Provider } from 'jotai';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  ACTIVE_HIGHLIGHT_NAME,
  MATCH_HIGHLIGHT_NAME,
  collectMatchRanges,
} from './dom';
import { inConversationFindOpenAtom, inConversationFindQueryAtom } from './state';
import InConversationFind from './InConversationFind';

const SCOPE_SELECTOR = '[data-testid="screenshot-target"]';

function mountConversation() {
  const fixture = document.createElement('div');
  fixture.setAttribute('data-find-fixture', '');
  fixture.innerHTML = `
    <div id="conversation-content">
      <div data-testid="screenshot-target">
        <div id="message-a"><p>the quick brown fox</p></div>
        <div id="message-b"><p>the lazy dog sleeps</p></div>
        <div id="message-c"><p>over the fence</p></div>
        <div hidden>the hidden match</div>
        <style>the styled match</style>
        <div hidden="until-found">the until-found match</div>
      </div>
      <div id="messages-end"></div>
    </div>
  `;
  document.body.appendChild(fixture);
  return fixture;
}

function mountEmptyConversation() {
  const fixture = document.createElement('div');
  fixture.setAttribute('data-find-fixture', '');
  fixture.innerHTML = '<div id="conversation-content"><div id="messages-end"></div></div>';
  document.body.appendChild(fixture);
  return fixture;
}

function renderFind(options: { open?: boolean; query?: string } = {}) {
  const store = createStore();
  store.set(inConversationFindOpenAtom, options.open ?? false);
  store.set(inConversationFindQueryAtom, options.query ?? '');
  return render(
    <Provider store={store}>
      <InConversationFind />
    </Provider>,
  );
}

const originalCSS = (globalThis as Record<string, unknown>).CSS;
const originalHighlight = (globalThis as Record<string, unknown>).Highlight;

beforeEach(() => {
  (globalThis as Record<string, unknown>).CSS = { highlights: new Map() };
  (globalThis as Record<string, unknown>).Highlight = class MockHighlight extends Set<Range> {
    constructor(...ranges: Range[]) {
      super(ranges);
    }
  };
});

afterEach(() => {
  (globalThis as Record<string, unknown>).CSS = originalCSS;
  (globalThis as Record<string, unknown>).Highlight = originalHighlight;
  document.querySelectorAll('[data-find-fixture]').forEach((node) => node.remove());
});

describe('InConversationFind', () => {
  it('leaves the browser find alone when no conversation is rendered', () => {
    renderFind();

    const notPrevented = fireEvent.keyDown(window, { key: 'f', ctrlKey: true });

    expect(notPrevented).toBe(true);
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
  });

  it('opens on Ctrl/Cmd+F inside a conversation and focuses an accessible search input', async () => {
    mountConversation();
    const user = userEvent.setup();
    renderFind();

    expect(fireEvent.keyDown(window, { key: 'f', ctrlKey: true })).toBe(false);

    const bar = screen.getByRole('search', { name: 'Find in conversation' });
    expect(bar).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Find in conversation' })).toHaveFocus();

    const input = screen.getByRole('textbox', { name: 'Find in conversation' });
    input.blur();
    await user.keyboard('{Control>}f{/Control}');
    expect(screen.getByRole('textbox', { name: 'Find in conversation' })).toHaveFocus();
  });

  it('counts matches in the rendered conversation and announces them politely', async () => {
    mountConversation();
    const user = userEvent.setup();
    renderFind();
    await user.keyboard('{Control>}f{/Control}');

    await user.type(screen.getByRole('textbox', { name: 'Find in conversation' }), 'the');

    expect(await screen.findByText('1 of 3 matches')).toBeInTheDocument();
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
  });

  it('excludes hidden and non-visible text from the count', async () => {
    mountConversation();
    const user = userEvent.setup();
    renderFind();
    await user.keyboard('{Control>}f{/Control}');

    await user.type(screen.getByRole('textbox', { name: 'Find in conversation' }), 'hidden');
    expect(await screen.findByText('No matches')).toBeInTheDocument();

    await user.clear(screen.getByRole('textbox', { name: 'Find in conversation' }));
    await user.type(screen.getByRole('textbox', { name: 'Find in conversation' }), 'styled');
    expect(await screen.findByText('No matches')).toBeInTheDocument();
  });

  it('registers highlights and moves them between matches', async () => {
    mountConversation();
    const user = userEvent.setup();
    renderFind();
    await user.keyboard('{Control>}f{/Control}');
    await user.type(screen.getByRole('textbox', { name: 'Find in conversation' }), 'the');

    await screen.findByText('1 of 3 matches');
    const highlights = (
      globalThis as unknown as { CSS: { highlights: Map<string, Set<Range>> } }
    ).CSS.highlights;
    const all = highlights.get(MATCH_HIGHLIGHT_NAME);
    const firstActiveSet = highlights.get(ACTIVE_HIGHLIGHT_NAME);
    const firstActive = firstActiveSet && firstActiveSet.size > 0 ? [...firstActiveSet][0] : undefined;
    expect(all?.size).toBe(3);
    expect(firstActive).toBeDefined();
    expect((firstActive?.startContainer as Text | null)?.data).toBe('the quick brown fox');

    await user.keyboard('{Enter}');
    expect(screen.getByText('2 of 3 matches')).toBeInTheDocument();

    const secondActiveSet = highlights.get(ACTIVE_HIGHLIGHT_NAME);
    const secondActive =
      secondActiveSet && secondActiveSet.size > 0 ? [...secondActiveSet][0] : undefined;
    expect((secondActive?.startContainer as Text | null)?.data).toBe('the lazy dog sleeps');
  });

  it('navigates with Enter and Shift+Enter, wrapping at both ends', async () => {
    mountConversation();
    const user = userEvent.setup();
    renderFind();
    await user.keyboard('{Control>}f{/Control}');
    await user.type(screen.getByRole('textbox', { name: 'Find in conversation' }), 'the');
    await screen.findByText('1 of 3 matches');

    await user.keyboard('{Enter}');
    expect(screen.getByText('2 of 3 matches')).toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(screen.getByText('3 of 3 matches')).toBeInTheDocument();

    /** Forward from the last match wraps to the first. */
    await user.keyboard('{Enter}');
    expect(screen.getByText('1 of 3 matches')).toBeInTheDocument();

    /** Backward from the first match wraps to the last. */
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(screen.getByText('3 of 3 matches')).toBeInTheDocument();
  });

  it('closes and clears on Escape, restoring focus to the opener', async () => {
    mountConversation();
    const user = userEvent.setup();
    const opener = document.createElement('button');
    opener.textContent = 'opener';
    document.body.appendChild(opener);
    opener.focus();

    renderFind();
    await user.keyboard('{Control>}f{/Control}');
    await user.type(screen.getByRole('textbox', { name: 'Find in conversation' }), 'the');
    await screen.findByText('1 of 3 matches');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());

    await user.keyboard('{Control>}f{/Control}');
    expect(screen.getByRole('textbox', { name: 'Find in conversation' })).toHaveValue('');
    opener.remove();
  });

  it('renders the loading state until the first scan of a restored query finishes', async () => {
    mountConversation();
    renderFind({ open: true, query: 'the' });

    expect(screen.getByText('Searching…')).toBeInTheDocument();
    expect(await screen.findByText('1 of 3 matches')).toBeInTheDocument();
  });

  it('reports no matches for a query that does not occur', async () => {
    mountConversation();
    const user = userEvent.setup();
    renderFind();
    await user.keyboard('{Control>}f{/Control}');

    await user.type(screen.getByRole('textbox', { name: 'Find in conversation' }), 'zzz');

    expect(await screen.findByText('No matches')).toBeInTheDocument();
  });

  it('reports an empty conversation when no messages are rendered', async () => {
    mountEmptyConversation();
    renderFind({ open: true, query: 'the' });

    expect(await screen.findByText('No messages to search yet')).toBeInTheDocument();
  });

  it('rescans when the conversation DOM changes', async () => {
    const fixture = mountConversation();
    const user = userEvent.setup();
    renderFind();
    await user.keyboard('{Control>}f{/Control}');
    await user.type(screen.getByRole('textbox', { name: 'Find in conversation' }), 'the');
    await screen.findByText('1 of 3 matches');

    const appended = document.createElement('p');
    appended.textContent = 'the appended match';
    act(() => {
      const scope = fixture.querySelector(SCOPE_SELECTOR);
      scope?.appendChild(appended);
    });

    expect(await screen.findByText('1 of 4 matches')).toBeInTheDocument();
  });

  it('closes itself when the conversation unmounts', async () => {
    const fixture = mountConversation();
    const user = userEvent.setup();
    renderFind();
    await user.keyboard('{Control>}f{/Control}');
    expect(screen.getByRole('search')).toBeInTheDocument();

    act(() => {
      fixture.remove();
    });

    await waitFor(() => expect(screen.queryByRole('search')).not.toBeInTheDocument());
  });
});

describe('collectMatchRanges', () => {
  it('returns literal, case-insensitive, non-overlapping ranges in document order', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Cat catalogue CAT.</p><p>no match here</p>';
    document.body.appendChild(root);

    const ranges = collectMatchRanges(root, 'cat');
    const offsets = ranges.map((range) => range.startOffset);

    expect(ranges).toHaveLength(3);
    expect(offsets).toEqual([0, 4, 14]);
    root.remove();
  });

  it('treats regex metacharacters as literals', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>a.b a.b</p>';
    document.body.appendChild(root);

    expect(collectMatchRanges(root, 'a.b')).toHaveLength(2);
    expect(collectMatchRanges(root, 'a?b')).toHaveLength(0);
    root.remove();
  });

  it('returns nothing for an empty query', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>text</p>';
    document.body.appendChild(root);

    expect(collectMatchRanges(root, '')).toHaveLength(0);
    root.remove();
  });
});
