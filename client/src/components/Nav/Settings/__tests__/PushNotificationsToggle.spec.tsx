import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PushNotificationsToggle from '../PushNotificationsToggle';

const mockGetPushConfig = jest.fn();
const mockSubscribe = jest.fn();
const mockUnsubscribe = jest.fn();
const mockShowToast = jest.fn();

jest.mock('~/data-provider', () => ({
  useGetPushConfig: () => mockGetPushConfig(),
}));

jest.mock('~/lib/webPush', () => ({
  subscribeToPush: (publicKey: string) => mockSubscribe(publicKey),
  unsubscribeFromPush: () => mockUnsubscribe(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

function config(enabled: boolean) {
  return {
    data: enabled ? { enabled: true, publicKey: 'test-public-key' } : { enabled: false },
    isLoading: false,
  };
}

describe('PushNotificationsToggle', () => {
  beforeEach(() => {
    mockGetPushConfig.mockReset().mockReturnValue(config(true));
    mockSubscribe.mockReset().mockResolvedValue(undefined);
    mockUnsubscribe.mockReset().mockResolvedValue(undefined);
    mockShowToast.mockReset();
  });

  it('renders nothing while the feature is unavailable', () => {
    mockGetPushConfig.mockReturnValue(config(false));
    const { container } = render(<PushNotificationsToggle />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('renders nothing while loading', () => {
    mockGetPushConfig.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<PushNotificationsToggle />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the switch with the localized label when enabled', () => {
    render(<PushNotificationsToggle />);
    expect(screen.getByRole('switch', { name: 'com_ui_push_notifications' })).toBeInTheDocument();
  });

  it('subscribes with the served VAPID key and toasts success on enable', async () => {
    render(<PushNotificationsToggle />);
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledWith('test-public-key'));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'com_ui_push_enabled',
        status: 'success',
      }),
    );
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('unsubscribes and toasts success on disable', async () => {
    render(<PushNotificationsToggle />);
    const toggle = screen.getByRole('switch');

    fireEvent.click(toggle);
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalled());

    fireEvent.click(toggle);
    await waitFor(() => expect(mockUnsubscribe).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'com_ui_push_disabled',
        status: 'success',
      }),
    );
    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it('reports a denied permission prompt without flipping the switch', async () => {
    mockSubscribe.mockRejectedValue(new Error('Notification permission denied'));
    render(<PushNotificationsToggle />);
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'com_ui_push_permission_denied',
        status: 'error',
      }),
    );
    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it('shows a generic error toast on other subscribe failures', async () => {
    mockSubscribe.mockRejectedValue(new Error('network down'));
    render(<PushNotificationsToggle />);
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'com_ui_error_updating_preferences',
        status: 'error',
      }),
    );
    expect(screen.getByRole('switch')).not.toBeChecked();
  });
});
