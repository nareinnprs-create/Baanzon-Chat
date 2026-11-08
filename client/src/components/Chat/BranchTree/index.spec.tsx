import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Provider as JotaiProvider, getDefaultStore } from 'jotai';
import { QueryKeys } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import BranchTree from '~/components/Chat/BranchTree';
import { siblingIdxFamily, siblingKey } from '~/components/Chat/Messages/Thread/state';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

/**
 * Tree: root U1 → A1 → R1, plus a second root U2 → R2 (a regen at the root
 * level) and A1 has a second child R1b. Two branch points.
 */
const MESSAGES: TMessage[] = [
  { messageId: 'U1', parentMessageId: null, isCreatedByUser: true, text: 'hello', depth: 0 } as TMessage,
  { messageId: 'R1', parentMessageId: 'U1', isCreatedByUser: false, text: 'answer one', depth: 1 } as TMessage,
  { messageId: 'U2', parentMessageId: null, isCreatedByUser: true, text: 'regen hello', depth: 0 } as TMessage,
  { messageId: 'R2', parentMessageId: 'U2', isCreatedByUser: false, text: 'answer two', depth: 1 } as TMessage,
  { messageId: 'R1b', parentMessageId: 'U1', isCreatedByUser: false, text: 'answer one alt', depth: 1 } as TMessage,
];

function renderTree() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData<TMessage[]>([QueryKeys.messages, 'convo-1'], MESSAGES);
  return render(
    <QueryClientProvider client={queryClient}>
      {/* Same store the assertions read: the component writes via useStore(). */}
      <JotaiProvider store={getDefaultStore()}>
        <MemoryRouter initialEntries={['/chat/convo-1']}>
          <Routes>
            <Route path="/chat/:conversationId" element={<BranchTree />} />
          </Routes>
        </MemoryRouter>
      </JotaiProvider>
    </QueryClientProvider>,
  );
}

describe('BranchTree', () => {
  beforeEach(() => {
    const store = getDefaultStore();
    store.set(siblingIdxFamily(siblingKey(null)), 0);
    store.set(siblingIdxFamily(siblingKey('U1')), 0);
  });

  it('renders the trigger and switches a branch by writing the thread sibling atom', async () => {
    const user = userEvent.setup();
    const store = getDefaultStore();
    // Viewing R1 (reversed index 1 of U1's [R1, R1b]) before switching.
    store.set(siblingIdxFamily(siblingKey('U1')), 1);

    renderTree();
    const trigger = screen.getByRole('button', { name: 'com_ui_branch_tree' });
    expect(trigger).toBeInTheDocument();

    await user.click(trigger);
    const altRow = await screen.findByRole('treeitem', { name: 'AI answer one alt' });
    await user.click(altRow);

    // Clicking R1b flips U1's selection to R1b's reversed index (and marks it selected).
    await waitFor(() => {
      expect(altRow).toHaveAttribute('aria-selected', 'true');
      expect(store.get(siblingIdxFamily(siblingKey('U1')))).not.toBe(1);
    });
  });

  it('marks the active branch path rows as selected', async () => {
    const user = userEvent.setup();
    renderTree();

    await user.click(screen.getByRole('button', { name: 'com_ui_branch_tree' }));
    // Default selections (both 0 = newest) walk U2 → R2, not U1 → R1.
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: 'com_ui_you regen hello' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('treeitem', { name: 'com_ui_you hello' })).toHaveAttribute('aria-selected', 'false');
    });
  });
});
