import React from 'react';
import { Provider, createStore, useSetAtom } from 'jotai';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

import PromptLabPanel from '../PromptLabPanel';
import { promptLabAtom } from '../atoms';
import type { PromptLabState } from '../atoms';

const onApplyMock = jest.fn();

const setStateIn = (state: PromptLabState) => {
  const store = createStore();
  function Seed() {
    useSetAtom(promptLabAtom)(state);
    return null;
  }
  return render(
    <Provider store={store}>
      <Seed />
      <PromptLabPanel onApply={onApplyMock} />
    </Provider>,
  );
};


describe('PromptLabPanel', () => {
  beforeEach(() => {
    onApplyMock.mockClear();
  });

  it('applies the rewrite through the host callback and closes', () => {
    setStateIn({ status: 'result', original: 'old prompt', rewrite: 'better prompt' });

    expect(screen.getByTestId('prompt-lab-original')).toHaveTextContent('old prompt');
    expect(screen.getByTestId('prompt-lab-rewrite')).toHaveTextContent('better prompt');

    fireEvent.click(screen.getByTestId('prompt-lab-apply'));

    expect(onApplyMock).toHaveBeenCalledTimes(1);
    expect(onApplyMock).toHaveBeenCalledWith('better prompt');
    expect(screen.queryByTestId('prompt-lab-panel')).not.toBeInTheDocument();
  });

  it('discards without writing to the composer', () => {
    setStateIn({ status: 'result', original: 'old prompt', rewrite: 'better prompt' });

    fireEvent.click(screen.getByTestId('prompt-lab-discard'));

    expect(onApplyMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('prompt-lab-panel')).not.toBeInTheDocument();
  });

  it('closes on Escape and announces loading politely', () => {
    setStateIn({ status: 'loading', original: 'x' });

    expect(screen.getByRole('region', { name: 'com_ui_prompt_lab' })).toBeInTheDocument();
    expect(screen.getByText('com_ui_loading')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('prompt-lab-panel')).not.toBeInTheDocument();
  });
});
