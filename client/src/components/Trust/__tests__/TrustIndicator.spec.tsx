/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import type { TTrustState } from 'librechat-data-provider';
import TrustIndicator from '../TrustIndicator';

jest.mock('~/hooks', () => ({
  useLocalize:
    () =>
    (key: string, options?: Record<string, unknown>): string => {
      const messages: Record<string, string> = {
        com_ui_trust_verified: 'Verified',
        com_ui_trust_supported: 'Supported',
        com_ui_trust_uncertain: 'Uncertain',
        com_ui_trust_conflicting: 'Conflicting',
        com_ui_trust_sources_count: 'Sources · {{0}}',
        com_ui_trust_label: 'Trust: {{0}}',
        com_ui_trust_label_sources: 'Trust: {{0}} · Sources · {{1}}',
      };
      let out = messages[key] ?? key;
      for (const [name, value] of Object.entries(options ?? {})) {
        out = out.replaceAll(`{{${name}}}`, String(value));
      }
      return out;
    },
}));

describe('TrustIndicator', () => {
  it.each([
    ['verified', 'Verified'],
    ['supported', 'Supported'],
    ['uncertain', 'Uncertain'],
    ['conflicting', 'Conflicting'],
  ] as [TTrustState, string][])(
    'renders the %s state with its localized label and aria-label',
    (state, label) => {
      render(<TrustIndicator state={state} />);

      expect(screen.getByRole('status')).toHaveAttribute('aria-label', `Trust: ${label}`);
      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );

  it('renders "Sources · N" when sourcesCount is positive', () => {
    render(<TrustIndicator state="verified" sourcesCount={3} />);

    expect(screen.getByText('Sources · 3')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Trust: Verified · Sources · 3',
    );
  });

  it.each([0, undefined])('hides the sources count for sourcesCount %s', (sourcesCount) => {
    render(<TrustIndicator state="uncertain" sourcesCount={sourcesCount} />);

    expect(screen.queryByText(/Sources ·/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Trust: Uncertain');
  });

  it('renders the small size on request', () => {
    render(<TrustIndicator state="supported" size="sm" />);

    const pill = screen.getByText('Supported');
    expect(pill).toHaveClass('px-1.5', 'text-xs');
    expect(pill).not.toHaveClass('px-2', 'text-sm');
  });

  it('defaults to the medium size', () => {
    render(<TrustIndicator state="supported" />);

    const pill = screen.getByText('Supported');
    expect(pill).toHaveClass('px-2', 'text-sm');
    expect(pill).not.toHaveClass('px-1.5', 'text-xs');
  });
});
