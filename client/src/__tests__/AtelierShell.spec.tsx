import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import AtelierShell from '~/components/Atelier';
import { interfaceMode, atelierFocusMode } from '~/store/settings';

/** `useInterfaceMode` reads the startup config through this hook; stubbed so
 *  the spec never opens a network query and only the local override decides. */
jest.mock('~/data-provider', () => ({
  ...jest.requireActual('~/data-provider'),
  useGetStartupConfig: jest.fn(() => ({ data: undefined })),
}));

/**
 * The composer's textarea is identified only by its test id (`data-testid=
 * "text-input"`), so a stand-in with the same id exercises the same document-
 * level focus tracking the real ChatForm feeds the hook.
 */
function ComposerStandIn() {
  return <textarea data-testid="text-input" aria-label="compose" />;
}

function renderShell(children = <ComposerStandIn />) {
  return render(<AtelierShell>{children}</AtelierShell>);
}

describe('AtelierShell', () => {
  beforeEach(() => {
    localStorage.clear();
    const store = getDefaultStore();
    store.set(interfaceMode, null);
    store.set(atelierFocusMode, false);
  });

  it('renders classic mode as a bare fragment: no [data-atelier] node', () => {
    renderShell();

    expect(screen.getByTestId('text-input')).toBeInTheDocument();
    expect(document.querySelector('[data-atelier="true"]')).toBeNull();
  });

  it('adds the data-atelier wrapper when the mode resolves to atelier', () => {
    const store = getDefaultStore();
    store.set(interfaceMode, 'atelier');

    renderShell();

    expect(document.querySelector('[data-atelier="true"]')).toBeInTheDocument();
  });

  it('dims the chrome only while the composer has focus, and Esc exits the mode', async () => {
    const store = getDefaultStore();
    store.set(interfaceMode, 'atelier');
    store.set(atelierFocusMode, true);

    renderShell();

    // No focus yet: the composer has never been entered.
    expect(document.body.hasAttribute('data-atelier-focus')).toBe(false);

    screen.getByTestId('text-input').focus();
    await waitFor(() => expect(document.body).toHaveAttribute('data-atelier-focus', 'true'));

    // Focus leaving the composer hands the chrome back.
    screen.getByTestId('text-input').blur();
    await waitFor(() => expect(document.body.hasAttribute('data-atelier-focus')).toBe(false));

    // Re-focus re-engages while the opt-in is still on...
    screen.getByTestId('text-input').focus();
    await waitFor(() => expect(document.body).toHaveAttribute('data-atelier-focus', 'true'));

    // ...but Esc turns the mode off and persists that (atomWithStorage writes).
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.body.hasAttribute('data-atelier-focus')).toBe(false));
    await waitFor(() => expect(localStorage.getItem('atelierFocusMode')).toBe('false'));
  });
});
