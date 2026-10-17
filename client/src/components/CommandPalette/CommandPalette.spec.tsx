import { createStore, Provider } from 'jotai';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import type { CommandPaletteItem } from './types';
import { commandPaletteOpenAtom } from './state';
import CommandPalette from './CommandPalette';

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

function renderPalette(props: { items: CommandPaletteItem[]; isLoading?: boolean }, open = true) {
  const store = createStore();
  store.set(commandPaletteOpenAtom, open);
  return render(
    <Provider store={store}>
      <CommandPalette {...props} />
    </Provider>,
  );
}

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
});
