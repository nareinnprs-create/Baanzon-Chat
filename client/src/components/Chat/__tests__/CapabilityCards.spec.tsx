import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import CapabilityCards from '../CapabilityCards';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

describe('CapabilityCards', () => {
  beforeEach(() => mockNavigate.mockClear());

  it('renders one card per real surface', () => {
    render(<CapabilityCards />);
    expect(screen.getByTestId('capability-card-ask')).toBeInTheDocument();
    expect(screen.getByTestId('capability-card-create')).toBeInTheDocument();
    expect(screen.getByTestId('capability-card-research')).toBeInTheDocument();
    expect(screen.getByTestId('capability-card-talk')).toBeInTheDocument();
  });

  it('navigates to the surface each card names', async () => {
    render(<CapabilityCards />);
    await userEvent.click(screen.getByTestId('capability-card-research'));
    expect(mockNavigate).toHaveBeenCalledWith('/deep-research');
    await userEvent.click(screen.getByTestId('capability-card-talk'));
    expect(mockNavigate).toHaveBeenCalledWith('/voice');
    await userEvent.click(screen.getByTestId('capability-card-create'));
    expect(mockNavigate).toHaveBeenCalledWith('/canvas');
  });

  it('focuses the composer for the ask card instead of sending', async () => {
    const onAsk = jest.fn();
    render(<CapabilityCards onAsk={onAsk} />);
    await userEvent.click(screen.getByTestId('capability-card-ask'));
    expect(onAsk).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
