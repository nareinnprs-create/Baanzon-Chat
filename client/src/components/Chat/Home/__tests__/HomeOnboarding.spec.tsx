import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import HomeOnboarding from '../HomeOnboarding';

const mockNewConversation = jest.fn();

let mockStartupConfig: { data: unknown; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};

jest.mock('~/Providers', () => ({
  useChatContext: () => ({ newConversation: mockNewConversation }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => mockStartupConfig,
}));

jest.mock('~/hooks', () => ({
  TranslationKeys: {},
  useLocalize: () => (key: string) => {
    const translations: Record<string, string> = {
      com_ui_home_heading: 'What are you working on?',
      com_ui_home_subcopy: 'Pick a starting point, or just start typing below.',
      com_ui_home_modes_label: 'Choose a starting mode',
      com_ui_home_modes_loading: 'Loading starting modes',
      com_ui_home_mode_chat: 'Chat',
      com_ui_home_mode_deep_research: 'Deep Research',
      com_ui_home_mode_data_analysis: 'Data analysis',
      com_ui_home_mode_image: 'Image',
    };
    return translations[key] ?? key;
  },
}));

jest.mock('~/utils', () => ({
  specDisplayFieldReset: {
    spec: null,
    iconURL: null,
    modelLabel: null,
    greeting: undefined,
  },
  getModelSpecPreset: (spec: { name: string; preset?: Record<string, unknown> }) => ({
    ...(spec.preset ?? {}),
    endpoint: (spec.preset?.endpoint as string) ?? null,
    spec: spec.name,
    iconURL: undefined,
  }),
}));

describe('HomeOnboarding', () => {
  beforeEach(() => {
    mockStartupConfig = { data: undefined, isLoading: false };
  });

  it('renders the localized heading, subcopy, and every mode chip', () => {
    render(<HomeOnboarding />);

    expect(screen.getByRole('heading', { name: 'What are you working on?' })).toBeInTheDocument();
    expect(
      screen.getByText('Pick a starting point, or just start typing below.'),
    ).toBeInTheDocument();

    const group = screen.getByRole('list', { name: 'Choose a starting mode' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deep Research' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Data analysis' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument();
  });

  it('chips are typed buttons so they are keyboard operable', () => {
    render(<HomeOnboarding />);

    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('type', 'button');
      expect(button).not.toBeDisabled();
    }
  });

  it('shows a loading status instead of chips while the config is loading', () => {
    mockStartupConfig = { data: undefined, isLoading: true };
    render(<HomeOnboarding />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading starting modes')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('starts a new conversation with the matching model spec when one is configured', () => {
    mockStartupConfig = {
      isLoading: false,
      data: {
        modelSpecs: {
          list: [
            {
              name: 'deep-research',
              preset: { endpoint: 'agents' },
            },
          ],
        },
      },
    };
    render(<HomeOnboarding />);

    fireEvent.click(screen.getByRole('button', { name: 'Deep Research' }));

    expect(mockNewConversation).toHaveBeenCalledTimes(1);
    expect(mockNewConversation).toHaveBeenCalledWith({
      template: expect.objectContaining({ conversationId: 'new' }),
      preset: expect.objectContaining({ spec: 'deep-research', endpoint: 'agents' }),
    });
  });

  it('falls back to the default endpoint when no matching spec exists', () => {
    mockStartupConfig = { data: { modelSpecs: { list: [] } }, isLoading: false };
    render(<HomeOnboarding />);

    fireEvent.click(screen.getByRole('button', { name: 'Image' }));

    expect(mockNewConversation).toHaveBeenCalledTimes(1);
    const call = mockNewConversation.mock.calls[0][0];
    expect(call.template).toEqual(expect.objectContaining({ conversationId: 'new' }));
    expect(call).not.toHaveProperty('preset');
  });

  it('starts a default conversation for the Chat chip', () => {
    render(<HomeOnboarding />);

    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));

    expect(mockNewConversation).toHaveBeenCalledTimes(1);
    const call = mockNewConversation.mock.calls[0][0];
    expect(call.template).toEqual(expect.objectContaining({ conversationId: 'new' }));
    expect(call).not.toHaveProperty('preset');
  });
});
