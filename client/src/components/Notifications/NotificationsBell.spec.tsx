import { createStore, Provider } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { TNotification } from 'librechat-data-provider';
import type { UseNotificationsResult } from '~/hooks/useNotifications';
import useNotifications from '~/hooks/useNotifications';
import { notificationsPanelOpenAtom } from './atoms';
import NotificationsBell from './NotificationsBell';

jest.mock('~/hooks/useNotifications', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockedUseNotifications = useNotifications as jest.MockedFunction<typeof useNotifications>;

function notification(overrides: Partial<TNotification> = {}): TNotification {
  return {
    id: 'n-1',
    type: 'agent_run',
    title: 'Run finished',
    body: 'Your agent completed',
    read: false,
    readAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockNotifications(
  overrides: Partial<UseNotificationsResult> = {},
): UseNotificationsResult {
  const value: UseNotificationsResult = {
    notifications: [],
    unreadCount: 0,
    hasMore: false,
    settings: { enabled: true, realtime: true, pollingIntervalMs: 60000 },
    isLoading: false,
    isError: false,
    isDisabled: false,
    refetch: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
    remove: jest.fn(),
    ...overrides,
  };
  mockedUseNotifications.mockReturnValue(value);
  return value;
}

function renderBell(open = false) {
  const store = createStore();
  store.set(notificationsPanelOpenAtom, open);
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <NotificationsBell />
      </MemoryRouter>
    </Provider>,
  );
}

describe('NotificationsBell', () => {
  it('shows an unread badge and an accessible trigger label', () => {
    mockNotifications({ unreadCount: 3 });
    renderBell();

    expect(screen.getByRole('button', { name: 'Activity Center, 3 unread' })).toBeInTheDocument();
    expect(screen.getByTestId('activity-center-badge')).toHaveTextContent('3');
  });

  it('caps the badge at 99+', () => {
    mockNotifications({ unreadCount: 250 });
    renderBell();

    expect(screen.getByTestId('activity-center-badge')).toHaveTextContent('99+');
  });

  it('renders nothing when the feature is disabled', () => {
    mockNotifications({ isDisabled: true });
    const { container } = renderBell();

    expect(container).toBeEmptyDOMElement();
  });

  it('lists notifications and marks one read when opened', async () => {
    const markRead = jest.fn();
    mockNotifications({ notifications: [notification()], unreadCount: 1, markRead });
    const user = userEvent.setup();
    renderBell(true);

    const dialog = screen.getByRole('dialog', { name: 'Notifications' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Run finished')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Run finished/ }));
    expect(markRead).toHaveBeenCalledWith('n-1');
  });

  it('marks all read and deletes', async () => {
    const markAllRead = jest.fn();
    const remove = jest.fn();
    mockNotifications({
      notifications: [notification()],
      unreadCount: 1,
      markAllRead,
      remove,
    });
    const user = userEvent.setup();
    renderBell(true);

    await user.click(screen.getByRole('button', { name: 'Mark all as read' }));
    expect(markAllRead).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete notification' }));
    expect(remove).toHaveBeenCalledWith('n-1');
  });

  it('shows the empty state with nothing to read', () => {
    mockNotifications({ notifications: [], unreadCount: 0 });
    renderBell(true);

    expect(screen.getByText("You're all caught up.")).toBeInTheDocument();
  });

  it('shows an error state that retries', async () => {
    const refetch = jest.fn();
    mockNotifications({ isError: true, refetch });
    const user = userEvent.setup();
    renderBell(true);

    expect(screen.getByText("We couldn't load your notifications.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });
});
