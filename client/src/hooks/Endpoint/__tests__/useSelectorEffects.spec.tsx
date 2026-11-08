import React, { useRef, useState, useCallback } from 'react';
import { renderHook, act } from '@testing-library/react';
import { EModelEndpoint } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import type { SelectedValues } from '~/common';
import useSelectorEffects from '../useSelectorEffects';
import { ChatContext } from '~/Providers';

type ChatContextValue = React.ContextType<typeof ChatContext>;

const chatContextValue = {
  conversation: null,
  setConversation: jest.fn(),
  preset: null,
  setPreset: jest.fn(),
} as unknown as ChatContextValue;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChatContext.Provider value={chatContextValue}>{children}</ChatContext.Provider>
);

const DEBOUNCE_MS = 150;

const initialValues: SelectedValues = { endpoint: null, model: null, modelSpec: null };

/** Mirrors ModelSelectorProvider: plain useState for the selector values, and counters
 *  so a loop is observable rather than inferred. The counting setter is stable, exactly
 *  as a raw useState setter is, so instrumenting it cannot itself create the instability
 *  under test. */
function useHarness(conversation: TConversation | null) {
  const renders = useRef(0);
  const writes = useRef(0);
  renders.current += 1;
  const [selectedValues, setSelectedValues] = useState<SelectedValues>(initialValues);
  const countingSetSelectedValues = useCallback<
    React.Dispatch<React.SetStateAction<SelectedValues>>
  >((value) => {
    writes.current += 1;
    setSelectedValues(value);
  }, []);
  useSelectorEffects({
    index: 0,
    agentsMap: undefined,
    assistantsMap: undefined,
    conversation,
    setSelectedValues: countingSetSelectedValues,
  });
  return { selectedValues, renderCount: renders.current, writeCount: writes.current };
}

const render = (conversation: TConversation | null) =>
  renderHook(({ conversation: c }: { conversation: TConversation | null }) => useHarness(c), {
    wrapper,
    initialProps: { conversation },
  });

const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

describe('useSelectorEffects', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('debounce timing contract', () => {
    it('does not write into context state before the delay elapses', () => {
      const { result } = render({
        endpoint: EModelEndpoint.openAI,
        model: 'gpt-4o',
        agent_id: null,
        assistant_id: null,
        spec: null,
      } as unknown as TConversation);

      advance(DEBOUNCE_MS - 1);
      expect(result.current.selectedValues).toBe(initialValues);

      advance(1);
      expect(result.current.selectedValues).toEqual({
        endpoint: EModelEndpoint.openAI,
        model: 'gpt-4o',
        modelSpec: '',
      });
    });

    it('coalesces repeated conversation changes into one write of the latest value', () => {
      const { result, rerender } = render({
        endpoint: EModelEndpoint.openAI,
        model: 'first',
        agent_id: null,
        assistant_id: null,
        spec: null,
      } as unknown as TConversation);

      advance(100);
      rerender({
        conversation: {
          endpoint: EModelEndpoint.anthropic,
          model: 'second',
          agent_id: null,
          assistant_id: null,
          spec: null,
        } as unknown as TConversation,
      });
      advance(100);
      rerender({
        conversation: {
          endpoint: EModelEndpoint.openAI,
          model: 'third',
          agent_id: null,
          assistant_id: null,
          spec: null,
        } as unknown as TConversation,
      });

      /** Nothing lands while changes keep arriving inside the window. */
      expect(result.current.selectedValues).toBe(initialValues);

      advance(DEBOUNCE_MS);
      expect(result.current.selectedValues).toEqual({
        endpoint: EModelEndpoint.openAI,
        model: 'third',
        modelSpec: '',
      });
    });
  });

  describe('what the effect writes into context state', () => {
    it('maps the agent id into the model slot for the agents endpoint', () => {
      const { result } = render({
        endpoint: EModelEndpoint.agents,
        model: null,
        agent_id: 'agent_abc',
        assistant_id: null,
        spec: null,
      } as unknown as TConversation);

      advance(DEBOUNCE_MS);
      expect(result.current.selectedValues).toEqual({
        endpoint: EModelEndpoint.agents,
        model: 'agent_abc',
        modelSpec: '',
      });
    });

    it('maps the assistant id into the model slot for the assistants endpoint', () => {
      const { result } = render({
        endpoint: EModelEndpoint.assistants,
        model: null,
        agent_id: null,
        assistant_id: 'asst_abc',
        spec: null,
      } as unknown as TConversation);

      advance(DEBOUNCE_MS);
      expect(result.current.selectedValues).toEqual({
        endpoint: EModelEndpoint.assistants,
        model: 'asst_abc',
        modelSpec: '',
      });
    });

    it('carries the spec through for a plain endpoint', () => {
      const { result } = render({
        endpoint: EModelEndpoint.openAI,
        model: 'gpt-4o',
        agent_id: null,
        assistant_id: null,
        spec: 'gpt-4o-reasoning',
      } as unknown as TConversation);

      advance(DEBOUNCE_MS);
      expect(result.current.selectedValues).toEqual({
        endpoint: EModelEndpoint.openAI,
        model: 'gpt-4o',
        modelSpec: 'gpt-4o-reasoning',
      });
    });

    it('prefers the agent id over the model when an agents conversation carries both', () => {
      const { result } = render({
        endpoint: EModelEndpoint.agents,
        model: 'underlying-model',
        agent_id: 'agent_abc',
        assistant_id: null,
        spec: null,
      } as unknown as TConversation);

      advance(DEBOUNCE_MS);
      expect(result.current.selectedValues.model).toBe('agent_abc');
    });

    it('writes nothing when the conversation has no endpoint', () => {
      const { result } = render({
        endpoint: null,
        model: 'gpt-4o',
        agent_id: null,
        assistant_id: null,
        spec: null,
      } as unknown as TConversation);

      advance(DEBOUNCE_MS * 4);
      expect(result.current.selectedValues).toBe(initialValues);
    });

    it('writes nothing for a null conversation', () => {
      const { result } = render(null);

      advance(DEBOUNCE_MS * 4);
      expect(result.current.selectedValues).toBe(initialValues);
    });

    it('writes nothing when the conversation names an endpoint but no model, agent, assistant or spec', () => {
      const { result } = render({
        endpoint: EModelEndpoint.openAI,
        model: null,
        agent_id: null,
        assistant_id: null,
        spec: null,
      } as unknown as TConversation);

      advance(DEBOUNCE_MS * 4);
      expect(result.current.selectedValues).toBe(initialValues);
    });
  });

  describe('cleanup', () => {
    it('cancels the pending write when the effect is torn down before the delay elapses', () => {
      const { result, unmount } = render({
        endpoint: EModelEndpoint.openAI,
        model: 'gpt-4o',
        agent_id: null,
        assistant_id: null,
        spec: null,
      } as unknown as TConversation);

      const written = result.current.selectedValues;
      unmount();

      advance(DEBOUNCE_MS * 4);
      expect(result.current.selectedValues).toBe(written);
    });

    it('drops a superseded value when the conversation changes inside the window', () => {
      const { result, rerender } = render({
        endpoint: EModelEndpoint.openAI,
        model: 'superseded',
        agent_id: null,
        assistant_id: null,
        spec: null,
      } as unknown as TConversation);

      rerender({
        conversation: {
          endpoint: EModelEndpoint.openAI,
          model: 'current',
          agent_id: null,
          assistant_id: null,
          spec: null,
        } as unknown as TConversation,
      });

      advance(DEBOUNCE_MS);
      expect(result.current.selectedValues.model).toBe('current');
    });
  });

  describe('no render loop', () => {
    it('settles on one write and stops writing once the debounce fires', () => {
      const { result } = render({
        endpoint: EModelEndpoint.openAI,
        model: 'gpt-4o',
        agent_id: null,
        assistant_id: null,
        spec: null,
      } as unknown as TConversation);

      advance(DEBOUNCE_MS);
      const settled = result.current.selectedValues;
      const rendersAtSettle = result.current.renderCount;

      expect(result.current.writeCount).toBe(1);

      /** An effect that re-arms itself on every commit writes a fresh object literal
       *  on each round, so the write count keeps climbing and state never stabilizes. */
      advance(DEBOUNCE_MS * 20);

      expect(result.current.selectedValues).toBe(settled);
      expect(result.current.renderCount).toBe(rendersAtSettle);
      expect(result.current.writeCount).toBe(1);
    });

    it('writes once per settled conversation, not once per debounce tick', () => {
      const { result, rerender } = render({
        endpoint: EModelEndpoint.openAI,
        model: 'model-0',
        agent_id: null,
        assistant_id: null,
        spec: null,
      } as unknown as TConversation);

      const models = ['model-1', 'model-2', 'model-3', 'model-4', 'model-5'];
      models.forEach((model) => {
        rerender({
          conversation: {
            endpoint: EModelEndpoint.openAI,
            model,
            agent_id: null,
            assistant_id: null,
            spec: null,
          } as unknown as TConversation,
        });
        advance(DEBOUNCE_MS);
      });

      /** One write per changed conversation that actually settles. The initial
       *  `model-0` value is superseded before its timer fires, so it never lands. */
      expect(result.current.selectedValues.model).toBe('model-5');
      expect(result.current.writeCount).toBe(models.length);

      advance(DEBOUNCE_MS * 20);

      expect(result.current.selectedValues.model).toBe('model-5');
      expect(result.current.writeCount).toBe(models.length);
    });
  });
});
