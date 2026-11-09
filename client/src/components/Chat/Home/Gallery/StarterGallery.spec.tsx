import { fireEvent, render, screen } from '@testing-library/react';
import StarterGallery from './StarterGallery';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/Providers', () => ({
  useChatFormContext: () => ({ setValue: jest.fn() }),
}));

describe('StarterGallery', () => {
  it('keeps the landing compact and reveals the full gallery on demand', () => {
    render(<StarterGallery />);

    expect(screen.getAllByRole('button')).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_show_more' }));
    expect(screen.getAllByRole('button')).toHaveLength(13);
  });
});
