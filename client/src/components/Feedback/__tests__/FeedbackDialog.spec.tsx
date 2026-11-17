import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FeedbackDialog from '../FeedbackDialog';

const mockSubmit = jest.fn();
const mockShowToast = jest.fn();

jest.mock('~/data-provider', () => ({
  useCreateFeedbackReportMutation: () => ({ mutate: mockSubmit, isLoading: false }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

function openDialog() {
  // The trigger's accessible name comes from the row label via aria-labelledby.
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_feedback_entry' }));
}

describe('FeedbackDialog', () => {
  beforeEach(() => {
    mockSubmit.mockClear();
    mockShowToast.mockClear();
  });

  it('keeps submit disabled until subject and message are filled', async () => {
    render(<FeedbackDialog />);
    openDialog();

    const submit = await screen.findByRole('button', { name: 'com_ui_feedback_submit' });
    expect(submit).toBeDisabled();

    fireEvent.change(await screen.findByLabelText('com_ui_feedback_subject_label'), {
      target: { value: 'Broken orb' },
    });
    expect(submit).toBeDisabled();

    fireEvent.change(await screen.findByLabelText('com_ui_feedback_message_label'), {
      target: { value: 'Orb does not speak' },
    });
    expect(submit).toBeEnabled();
  });

  it('submits the selected type and text, then shows the success toast', async () => {
    render(<FeedbackDialog />);
    openDialog();

    fireEvent.change(await screen.findByLabelText('com_ui_feedback_subject_label'), {
      target: { value: 'Broken orb' },
    });
    fireEvent.change(await screen.findByLabelText('com_ui_feedback_message_label'), {
      target: { value: 'Orb does not speak' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_feedback_type_feature' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_feedback_submit' }));

    expect(mockSubmit).toHaveBeenCalledWith(
      { type: 'feature', subject: 'Broken orb', message: 'Orb does not speak' },
      expect.anything(),
    );

    const callbacks = mockSubmit.mock.calls[0][1] as { onSuccess: () => void };
    callbacks.onSuccess();
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'com_ui_feedback_success', status: 'success' }),
      ),
    );
  });

  it('shows the error toast when submission fails', async () => {
    render(<FeedbackDialog />);
    openDialog();

    fireEvent.change(await screen.findByLabelText('com_ui_feedback_subject_label'), {
      target: { value: 'Broken orb' },
    });
    fireEvent.change(await screen.findByLabelText('com_ui_feedback_message_label'), {
      target: { value: 'Orb does not speak' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_feedback_submit' }));

    const callbacks = mockSubmit.mock.calls[0][1] as { onError: () => void };
    callbacks.onError();
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'com_ui_feedback_error', status: 'error' }),
      ),
    );
  });

  it('clears the form after a successful submission', async () => {
    render(<FeedbackDialog />);
    openDialog();

    const subject = await screen.findByLabelText('com_ui_feedback_subject_label');
    const message = await screen.findByLabelText('com_ui_feedback_message_label');
    fireEvent.change(subject, { target: { value: 'Broken orb' } });
    fireEvent.change(message, { target: { value: 'Orb does not speak' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_feedback_submit' }));

    const callbacks = mockSubmit.mock.calls[0][1] as { onSuccess: () => void };
    callbacks.onSuccess();

    await waitFor(() => {
      expect(subject).toHaveValue('');
      expect(message).toHaveValue('');
    });
  });
});
