import { createStore, Provider } from 'jotai';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import type { TSearchAllResponse } from 'librechat-data-provider';
import type { CommandPaletteItem } from './types';
import { useCrossEntitySearch } from '~/data-provider/CrossSearch/queries';
import { commandPaletteOpenAtom } from './state';
import CommandPalette from './CommandPalette';

jest.mock('~/data-provider/CrossSearch/queries', () => ({
  ...jest.requireActual('~/data-provider/CrossSearch/queries'),
  useCrossEntitySearch: jest.fn(),
}));

const mockedUseCrossEntitySearch = jest.mocked(useCrossEntitySearch);

/** Controls what the mocked cross-entity hook reports to the palette. */
function mockSearchResult(data?: TSearchAllResponse, isFetching = false) {
  mockedUseCrossEntitySearch.mockReturnValue({
    data,
    isFetching,
  } as unknown as ReturnType<typeof useCrossEntitySearch>);
}

function makeRecords(): TSearchAllResponse['results'] {
  return [
    {
      type: 'conversation',
      id: 'conv-1',
      title: 'Retro planning doc',
      updatedAt: '2026-10-27T10:00:00Z',
      href: '/c/conv-1',
    },
    {
      type: 'project',
      id: 'proj-1',
      title: 'Launch project',
      updatedAt: '2026-10-26T10:00:00Z',
      href: '/projects/proj-1',
    },
  ];
}

function makeItems(): CommandPaletteItem[] {
  return [
    {
      id: 'new-chat',
      group: 'actions',
      labelKey: 'com_ui_command_palette_action_new_chat',
      keywords: ['new', 'chat', 'conversation'],
      run: jest.fn(),
    },
    {
      id: 'toggle-theme',
      group: 'actions',
      labelKey: 'com_ui_command_palette_action_toggle_theme',
      keywords: ['theme', 'dark', 'light'],
      run: jest.fn(),
    },
    {
      id: 'nav-agents',
      group: 'navigation',
      labelKey: 'com_ui_command_palette_nav_agents',
      keywords: ['agents', 'navigate'],
      run: jest.fn(),
    },
  ];
}

function renderPalette(
  props: {
    items: CommandPaletteItem[];
    isLoading?: boolean;
    onNavigate?: (href: string) => void;
  },
  open = true,
) {
  const store = createStore();
  store.set(commandPaletteOpenAtom, open);
  return render(
    <Provider store={store}>
      <CommandPalette {...props} />
    </Provider>,
  );
}

beforeEach(() => {
  mockSearchResult(undefined);
});

describe('CommandPalette', () => {
  it('opens on the global Ctrl/Cmd+K binding', async () => {
    const user = userEvent.setup();
    renderPalette({ items: makeItems() }, false);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.keyboard('{Control>}k{/Control}');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveFocus();
  });

  it('exposes dialog, combobox, listbox and option roles', () => {
    renderPalette({ items: makeItems() });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const combobox = screen.getByRole('combobox');
    expect(combobox).toHaveAttribute('aria-expanded', 'true');
    expect(combobox).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('filters by label and keyword and reports no results', async () => {
    const user = userEvent.setup();
    renderPalette({ items: makeItems() });

    await user.type(screen.getByRole('combobox'), 'dark');

    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveTextContent('Toggle theme');

    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'zzzzz');

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByText('No matching commands')).toBeInTheDocument();
  });

  it('renders the empty state when there are no actions', () => {
    renderPalette({ items: [] });

    expect(screen.getByText('No commands available')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('renders a loading status instead of the list', () => {
    renderPalette({ items: makeItems(), isLoading: true });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('moves the active option with arrows and runs it on Enter', async () => {
    const user = userEvent.setup();
    const items = makeItems();
    renderPalette({ items });

    const combobox = screen.getByRole('combobox');
    await user.type(combobox, '{ArrowDown}{Enter}');

    expect(items[1].run).toHaveBeenCalledTimes(1);
    expect(items[0].run).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('runs an option on click', async () => {
    const user = userEvent.setup();
    const items = makeItems();
    renderPalette({ items });

    await user.click(screen.getByRole('option', { name: 'Go to Agents' }));

    expect(items[2].run).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and restores focus to the opener', async () => {
    const user = userEvent.setup();
    renderPalette({ items: makeItems() }, false);

    const opener = document.createElement('button');
    opener.textContent = 'opener';
    document.body.appendChild(opener);
    opener.focus();

    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  });

  describe('cross-entity search results', () => {
    it('renders hits as a Results group once the query reaches two characters', async () => {
      const user = userEvent.setup();
      mockSearchResult({ results: makeRecords() });
      renderPalette({ items: makeItems() });

      await user.type(screen.getByRole('combobox'), 'ret');

      expect(mockedUseCrossEntitySearch).toHaveBeenCalledWith('ret');
      expect(screen.getByText('Results')).toBeInTheDocument();
      /** 'ret' matches no static command, so the two hits are the only options. */
      expect(screen.getAllByRole('option')).toHaveLength(2);
      /** The first row starts active, like every other palette row. */
      expect(screen.getByRole('option', { name: 'Retro planning doc' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByRole('option', { name: 'Launch project' })).toBeInTheDocument();
    });

    it('renders no results group below two characters and lets the hook gate the fetch', async () => {
      const user = userEvent.setup();
      /** Cached data on purpose: the palette must hide it while the query is short. */
      mockSearchResult({ results: makeRecords() });
      renderPalette({ items: makeItems() });

      await user.type(screen.getByRole('combobox'), 'q');

      expect(mockedUseCrossEntitySearch).toHaveBeenCalledWith('q');
      expect(screen.queryByText('Results')).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Retro planning doc' })).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Launch project' })).not.toBeInTheDocument();
      expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });

    it('navigates to a hit href on Enter and closes the palette', async () => {
      const user = userEvent.setup();
      const items = makeItems();
      const onNavigate = jest.fn();
      mockSearchResult({ results: makeRecords() });
      renderPalette({ items, onNavigate });

      const combobox = screen.getByRole('combobox');
      await user.type(combobox, 'ret');
      await user.type(combobox, '{End}{Enter}');

      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith('/projects/proj-1');
      expect(items[0].run).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('keeps hits inside the arrow-key flow before running them', async () => {
      const user = userEvent.setup();
      const onNavigate = jest.fn();
      mockSearchResult({ results: makeRecords() });
      renderPalette({ items: makeItems(), onNavigate });

      const combobox = screen.getByRole('combobox');
      await user.type(combobox, 'chat');

      /** The matching command first, then the two hits. */
      expect(screen.getAllByRole('option')).toHaveLength(3);
      await user.type(combobox, '{ArrowDown}{Enter}');

      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith('/c/conv-1');
    });

    it('shows a subtle searching row while the query is in flight', async () => {
      const user = userEvent.setup();
      mockSearchResult(undefined, true);
      renderPalette({ items: makeItems() });

      await user.type(screen.getByRole('combobox'), 'ret');

      expect(screen.getByText('Searching…')).toBeInTheDocument();
      expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });

    it('reports an empty search inline while commands still match', async () => {
      const user = userEvent.setup();
      mockSearchResult({ results: [] });
      renderPalette({ items: makeItems() });

      await user.type(screen.getByRole('combobox'), 'chat');

      expect(screen.getByText('Results')).toBeInTheDocument();
      expect(screen.getByText('No results found')).toBeInTheDocument();
      /** Only 'New chat' matches among the static commands. */
      expect(screen.getAllByRole('option')).toHaveLength(1);
    });
  });
});
