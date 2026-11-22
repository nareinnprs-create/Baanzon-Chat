import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import ComposerToolsSheet from '../ComposerToolsSheet';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const tool = <span data-testid="tool" />;

describe('ComposerToolsSheet', () => {
  it('renders nothing while closed', () => {
    render(
      <ComposerToolsSheet open={false} onClose={jest.fn()}>
        {tool}
      </ComposerToolsSheet>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows its tools and closes from the close button', async () => {
    const onClose = jest.fn();
    render(
      <ComposerToolsSheet open onClose={onClose}>
        {tool}
      </ComposerToolsSheet>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('tool')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const onClose = jest.fn();
    render(
      <ComposerToolsSheet open onClose={onClose}>
        {tool}
      </ComposerToolsSheet>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('moves focus into the sheet and back to the trigger on close', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(
      <ComposerToolsSheet open onClose={jest.fn()}>
        {tool}
      </ComposerToolsSheet>,
    );
    expect(screen.getByRole('button', { name: 'com_ui_close' })).toHaveFocus();

    rerender(
      <ComposerToolsSheet open={false} onClose={jest.fn()}>
        {tool}
      </ComposerToolsSheet>,
    );
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
