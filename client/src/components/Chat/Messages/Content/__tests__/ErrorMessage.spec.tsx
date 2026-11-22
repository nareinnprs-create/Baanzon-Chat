import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { TMessage } from 'librechat-data-provider';
import { ErrorMessage } from '../MessageContent';

const mockRegenerate = jest.fn();

jest.mock('~/Providers', () => ({
  useMessageContext: () => ({}),
  useOptionalMessagesOperations: () => ({ regenerate: mockRegenerate }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('../Container', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('~/components/Messages/Content/Error', () => ({
  __esModule: true,
  default: ({ text }: { text: string }) => <span>{text}</span>,
}));

const message = {
  messageId: 'assistant-1',
  parentMessageId: 'user-1',
  isCreatedByUser: false,
} as TMessage;

describe('ErrorMessage', () => {
  beforeEach(() => mockRegenerate.mockClear());

  it('offers a retry that regenerates the failed reply', async () => {
    render(<ErrorMessage text="boom" message={message} />);
    const retry = screen.getByTestId('error-retry-button');
    expect(retry).toHaveTextContent('com_ui_retry');
    await userEvent.click(retry);
    expect(mockRegenerate).toHaveBeenCalledWith(message);
  });

  it('disables retry when the message is unknown', () => {
    render(<ErrorMessage text="boom" />);
    expect(screen.getByTestId('error-retry-button')).toBeDisabled();
  });
});
