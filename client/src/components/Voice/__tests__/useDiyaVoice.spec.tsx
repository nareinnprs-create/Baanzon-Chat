import { Provider as JotaiProvider, createStore } from 'jotai';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { VoiceHistoryTurn } from '../types';
import { VOICE_LABELS } from '~/components/Voice/labels';
import useDiyaVoice from '~/hooks/useDiyaVoice';
import { DiyaTurnError } from '../api';

/**
 * Drives the Diya Orb state machine with fakes for the Web Speech APIs and the
 * turn seam: recognition emits results, the turn resolves the reply, and
 * synthesis reports start/end so the hook moves listening → thinking →
 * speaking → listening.
 */

type FakeResult = { isFinal: boolean; transcript: string };

class FakeRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  startCalls = 0;
  stopCalls = 0;
  abortCalls = 0;
  started = false;

  start(): void {
    this.startCalls += 1;
    if (this.started) {
      throw new DOMException('already started', 'InvalidStateError');
    }
    this.started = true;
  }

  stop(): void {
    this.stopCalls += 1;
    this.started = false;
    this.onend?.();
  }

  abort(): void {
    this.abortCalls += 1;
    this.started = false;
  }

  /** Emits one recognition result at the given absolute index. */
  emit(result: FakeResult, index = 0): void {
    const item = { transcript: result.transcript };
    this.onresult?.({
      resultIndex: index,
      results: { length: index + 1, [index]: { isFinal: result.isFinal, 0: item, length: 1 } },
    });
  }
}

interface FakeUtterance {
  text: string;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

function mockGetUserMedia(impl: () => Promise<MediaStream>): jest.Mock {
  const getUserMedia = jest.fn(impl);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  return getUserMedia;
}

function createFakeStream(): { stream: MediaStream; stop: jest.Mock } {
  const stop = jest.fn();
  const track = { stop, kind: 'audio' } as unknown as MediaStreamTrack;
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, stop };
}

function restoreMediaDevices(): void {
  if (originalMediaDevices != null) {
    Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
    return;
  }
  Reflect.deleteProperty(navigator, 'mediaDevices');
}

function restoreSpeech(): void {
  Reflect.deleteProperty(window, 'speechSynthesis');
  Reflect.deleteProperty(window, 'SpeechSynthesisUtterance');
  Reflect.deleteProperty(window, 'SpeechRecognition');
  Reflect.deleteProperty(window, 'webkitSpeechRecognition');
}

interface Harness {
  result: ReturnType<typeof useDiyaVoice>;
  recognition: FakeRecognition;
  turnCalls: Array<{ text: string; history: VoiceHistoryTurn[] }>;
  /** Resolves the pending turn and lets synthesis lifecycle run. */
  replyWith: (text: string) => Promise<void>;
  startSpeaking: () => void;
  endSpeaking: () => void;
  failWith: (error: unknown) => Promise<void>;
  unmount: () => void;
}

/** Mounts the hook with Web Speech fakes and a programmable turn seam. `installRecognition`
 *  set to `false` mounts without the `SpeechRecognition` fake for the unsupported path. */
function renderVoice(
  options: Parameters<typeof useDiyaVoice>[0] = {},
  installRecognition = true,
): Harness {
  const recognition = new FakeRecognition();
  if (installRecognition) {
    Object.defineProperty(window, 'SpeechRecognition', {
      value: jest.fn(() => recognition),
      configurable: true,
    });
  }

  const spoken: FakeUtterance[] = [];
  const synthesis = {
    speak: (utterance: FakeUtterance) => {
      spoken.push(utterance);
    },
    cancel: jest.fn(),
    getVoices: () => [],
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synthesis, configurable: true });
  (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
    text: string;
    lang = '';
    voice: unknown = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  };

  const { stream, stop } = createFakeStream();
  const getUserMedia = mockGetUserMedia(() => Promise.resolve(stream));

  const turnCalls: Array<{ text: string; history: VoiceHistoryTurn[] }> = [];
  let resolver: ((text: string) => void) | null = null;
  let rejecter: ((error: unknown) => void) | null = null;
  const turn = jest.fn(
    (text: string, history: VoiceHistoryTurn[]) =>
      new Promise<string>((resolve, reject) => {
        turnCalls.push({ text, history });
        resolver = resolve;
        rejecter = reject;
      }),
  );

  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <JotaiProvider store={store}>{children}</JotaiProvider>
  );
  const rendered = renderHook(() => useDiyaVoice({ ...options, turn }), { wrapper });

  // A live proxy: `rendered.result.current` is a new object each render, so a
  // captured snapshot would read stale status/transcripts forever.
  const result = new Proxy({} as ReturnType<typeof useDiyaVoice>, {
    get: (_target, prop) =>
      (rendered.result.current as unknown as Record<string | symbol, unknown>)[prop],
  });

  return {
    result,
    recognition,
    turnCalls,
    // Awaited so the turn's continuation (transcript append + speak) flushes
    // before the caller drives the next lifecycle step.
    replyWith: async (text) => {
      await act(async () => {
        resolver?.(text);
      });
    },
    startSpeaking: () => act(() => spoken[0]?.onstart?.()),
    endSpeaking: () => act(() => spoken[0]?.onend?.()),
    failWith: async (error) => {
      await act(async () => {
        rejecter?.(error);
      });
    },
    unmount: () => {
      rendered.unmount();
      restoreSpeech();
      restoreMediaDevices();
      getUserMedia.mockClear();
      stop.mockClear();
      spoken.length = 0;
    },
  };
}

describe('useDiyaVoice', () => {
  afterEach(restoreSpeech);
  afterEach(restoreMediaDevices);

  it('reports unsupported and stays unsupported when the browser lacks the speech APIs', async () => {
    Reflect.deleteProperty(window, 'SpeechRecognition');
    const harness = renderVoice({}, false);

    expect(harness.result.supported).toBe(false);
    await waitFor(() => expect(harness.result.status).toBe('unsupported'));
    await act(async () => {
      await harness.result.start();
    });
    expect(harness.result.status).toBe('unsupported');
    harness.unmount();
  });

  it('moves idle → listening when the session starts', async () => {
    const harness = renderVoice();
    const { result, recognition } = harness;

    await act(async () => {
      await result.start();
    });

    expect(result.status).toBe('listening');
    expect(recognition.startCalls).toBeGreaterThan(0);
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    harness.unmount();
  });

  it('upserts interim transcripts and finalizes the same line, then runs the turn', async () => {
    const harness = renderVoice();
    const { result, recognition, turnCalls } = harness;

    await act(async () => {
      await result.start();
    });

    act(() => recognition.emit({ isFinal: false, transcript: 'he' }, 0));
    await waitFor(() => {
      const interim = result.transcripts[0];
      expect(interim?.text).toBe('he');
      expect(interim?.final).toBe(false);
    });

    act(() => recognition.emit({ isFinal: true, transcript: 'hello there' }, 0));
    await waitFor(() => expect(result.status).toBe('thinking'));
    expect(result.transcripts[0]).toMatchObject({
      role: 'user',
      text: 'hello there',
      final: true,
    });
    expect(turnCalls).toHaveLength(1);
    expect(turnCalls[0].text).toBe('hello there');
    expect(turnCalls[0].history).toEqual([]);
    harness.unmount();
  });

  it('goes thinking → speaking on the reply, appends the assistant line, then returns to listening', async () => {
    const harness = renderVoice();
    const { result, recognition } = harness;

    await act(async () => {
      await result.start();
    });
    act(() => recognition.emit({ isFinal: true, transcript: 'hello' }, 0));
    await waitFor(() => expect(result.status).toBe('thinking'));
    expect(recognition.stopCalls).toBeGreaterThan(0);

    await harness.replyWith('Hi! How can I help?');
    await waitFor(() => {
      const assistant = result.transcripts.find((line) => line.role === 'assistant');
      expect(assistant?.text).toBe('Hi! How can I help?');
    });
    harness.startSpeaking();
    await waitFor(() => expect(result.status).toBe('speaking'));

    harness.endSpeaking();
    await waitFor(() => expect(result.status).toBe('listening'));
    expect(result.transcripts).toHaveLength(2);
    harness.unmount();
  });

  it('echoes settled history to the turn and never includes the current utterance', async () => {
    const harness = renderVoice();
    const { result, recognition, turnCalls } = harness;

    await act(async () => {
      await result.start();
    });
    act(() => recognition.emit({ isFinal: true, transcript: 'first question' }, 0));
    await waitFor(() => expect(turnCalls).toHaveLength(1));
    await harness.replyWith('first answer');
    harness.startSpeaking();
    await waitFor(() => expect(result.status).toBe('speaking'));
    harness.endSpeaking();
    await waitFor(() => expect(result.status).toBe('listening'));

    act(() => recognition.emit({ isFinal: true, transcript: 'second question' }, 1));
    await waitFor(() => expect(turnCalls).toHaveLength(2));
    expect(turnCalls[1].history).toEqual([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
    ]);
    harness.unmount();
  });

  it('surfaces a turn failure as an error label and returns to listening', async () => {
    const harness = renderVoice();
    const { result, recognition } = harness;

    await act(async () => {
      await result.start();
    });
    act(() => recognition.emit({ isFinal: true, transcript: 'hello' }, 0));
    await waitFor(() => expect(result.status).toBe('thinking'));

    await harness.failWith(new Error('boom'));
    // Unclassified failures surface the generic label; only DiyaTurnError codes
    // map to the specific turn labels.
    await waitFor(() => expect(result.error).toBe(VOICE_LABELS.errorDescription));
    expect(result.status).toBe('listening');
    harness.unmount();
  });

  it('maps turn error codes to their labels', async () => {
    const harness = renderVoice();
    const { result, recognition } = harness;

    await act(async () => {
      await result.start();
    });
    act(() => recognition.emit({ isFinal: true, transcript: 'hello' }, 0));
    await waitFor(() => expect(result.status).toBe('thinking'));
    await harness.failWith(new DiyaTurnError('unavailable'));
    await waitFor(() => expect(result.error).toBe(VOICE_LABELS.turnUnavailable));
    harness.unmount();
  });

  it('tears down to idle on stop, releasing the microphone', async () => {
    const harness = renderVoice();
    const { result, recognition } = harness;

    await act(async () => {
      await result.start();
    });
    expect(result.status).toBe('listening');

    act(() => result.stop());
    expect(result.status).toBe('idle');
    expect(recognition.abortCalls).toBeGreaterThan(0);
    expect(result.transcripts).toHaveLength(0);
    harness.unmount();
  });

  it('denied microphone access surfaces the permission label in the error state', async () => {
    const harness = renderVoice();
    // Re-mock after renderVoice: its resolving fake would otherwise win.
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    mockGetUserMedia(() => Promise.reject(denied));
    const { result } = harness;

    await act(async () => {
      await result.start();
    });

    expect(result.status).toBe('error');
    expect(result.error).toBe(VOICE_LABELS.micPermissionDenied);
    harness.unmount();
  });

  it('mutes without sending turns and restores the listening floor on unmute', async () => {
    const harness = renderVoice();
    const { result, recognition, turnCalls } = harness;

    await act(async () => {
      await result.start();
    });

    act(() => result.setMuted(true));
    expect(result.status).toBe('muted');

    act(() => recognition.emit({ isFinal: true, transcript: 'heard while muted' }, 0));
    expect(turnCalls).toHaveLength(0);

    act(() => result.setMuted(false));
    expect(result.status).toBe('listening');
    harness.unmount();
  });

  it('interrupt cancels the current turn and returns to listening with barge-in flagged', async () => {
    const harness = renderVoice();
    const { result, recognition } = harness;

    await act(async () => {
      await result.start();
    });
    act(() => recognition.emit({ isFinal: true, transcript: 'hello' }, 0));
    await waitFor(() => expect(result.status).toBe('thinking'));

    act(() => result.interrupt());
    await waitFor(() => expect(result.status).toBe('listening'));
    expect(result.bargeIn).toBe(true);
    harness.unmount();
  });
});
