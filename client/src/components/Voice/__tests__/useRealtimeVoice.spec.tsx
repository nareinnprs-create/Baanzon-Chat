import { Provider as JotaiProvider, createStore } from 'jotai';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { VoiceTransport, VoiceTransportEvent, VoiceTranscript } from '../types';
import { VOICE_LABELS } from '~/components/Voice/labels';
import useRealtimeVoice from '~/hooks/useRealtimeVoice';

interface FakeTransport {
  transport: VoiceTransport;
  connectCalls: number;
  closeCalls: number;
  bargeInCalls: number;
  connectError: Error | null;
  micStreams: Array<MediaStream | null>;
  emit: (event: VoiceTransportEvent) => void;
}

/** A transport stand-in: records lifecycle calls and lets the test drive events. */
function createFakeTransport(): FakeTransport {
  const trackListeners = new Set<(track: MediaStreamTrack) => void>();
  const eventListeners = new Set<(event: VoiceTransportEvent) => void>();
  const state: FakeTransport = {
    connectCalls: 0,
    closeCalls: 0,
    bargeInCalls: 0,
    connectError: null,
    micStreams: [],
    emit: (event) => eventListeners.forEach((listener) => listener(event)),
    transport: {
      connect: async () => {
        state.connectCalls += 1;
        if (state.connectError != null) {
          throw state.connectError;
        }
      },
      setMicrophoneStream: (stream) => {
        state.micStreams.push(stream);
      },
      onTrack: (listener) => {
        trackListeners.add(listener);
        return () => {
          trackListeners.delete(listener);
        };
      },
      onEvent: (listener) => {
        eventListeners.add(listener);
        return () => {
          eventListeners.delete(listener);
        };
      },
      bargeIn: () => {
        state.bargeInCalls += 1;
      },
      close: () => {
        state.closeCalls += 1;
      },
    },
  };
  return state;
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

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

function mockGetUserMedia(
  impl: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
): jest.Mock {
  const getUserMedia = jest.fn(impl);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  return getUserMedia;
}

function restoreMediaDevices(): void {
  if (originalMediaDevices != null) {
    Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
    return;
  }
  Reflect.deleteProperty(navigator, 'mediaDevices');
}

function renderVoice(options: Parameters<typeof useRealtimeVoice>[0] = {}) {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <JotaiProvider store={store}>{children}</JotaiProvider>
  );
  return renderHook(() => useRealtimeVoice(options), { wrapper });
}

describe('useRealtimeVoice', () => {
  afterEach(restoreMediaDevices);

  it('reports unsupported when no transport is supplied and the browser APIs are absent', async () => {
    const { result } = renderVoice({});

    expect(result.current.supported).toBe(false);
    await waitFor(() => expect(result.current.status).toBe('unsupported'));

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('unsupported');
  });

  it('negotiates an injected transport and reaches the listening state', async () => {
    const fake = createFakeTransport();
    const { result } = renderVoice({ transport: fake.transport });

    expect(result.current.supported).toBe(true);
    expect(result.current.status).toBe('idle');

    await act(async () => {
      await result.current.start();
    });

    expect(fake.connectCalls).toBe(1);
    expect(result.current.status).toBe('listening');
    expect(result.current.error).toBeNull();
  });

  it('toggles from idle to listening and back to idle', async () => {
    const fake = createFakeTransport();
    const { result } = renderVoice({ transport: fake.transport });

    await act(async () => {
      result.current.toggle();
    });
    await waitFor(() => expect(result.current.status).toBe('listening'));

    act(() => {
      result.current.toggle();
    });

    expect(result.current.status).toBe('idle');
    expect(fake.closeCalls).toBe(1);
  });

  it('mutes and unmutes an active session', async () => {
    const fake = createFakeTransport();
    const { result } = renderVoice({ transport: fake.transport });
    await act(async () => {
      await result.current.start();
    });

    act(() => {
      result.current.setMuted(true);
    });
    expect(result.current.muted).toBe(true);
    expect(result.current.status).toBe('muted');

    act(() => {
      result.current.setMuted(false);
    });
    expect(result.current.muted).toBe(false);
    expect(result.current.status).toBe('listening');
  });

  it('shows speaking status, records barge-in, and forwards transcripts', async () => {
    const onTranscript = jest.fn();
    const fake = createFakeTransport();
    const { result } = renderVoice({ transport: fake.transport, onTranscript });
    await act(async () => {
      await result.current.start();
    });

    const transcript: VoiceTranscript = {
      id: 't1',
      role: 'user',
      text: 'Hello there',
      final: true,
      at: 1,
    };

    act(() => {
      fake.emit({ type: 'assistant-speaking', speaking: true });
    });
    expect(result.current.status).toBe('speaking');

    act(() => {
      result.current.interrupt();
    });
    expect(fake.bargeInCalls).toBe(1);
    expect(result.current.bargeIn).toBe(true);

    act(() => {
      fake.emit({ type: 'transcript', transcript });
    });
    expect(result.current.transcripts).toHaveLength(1);
    expect(result.current.transcripts[0]).toEqual(transcript);
    expect(onTranscript).toHaveBeenCalledWith(transcript);

    act(() => {
      fake.emit({ type: 'assistant-speaking', speaking: false });
    });
    expect(result.current.status).toBe('listening');
    expect(result.current.bargeIn).toBe(false);
  });

  it('surfaces a transport failure as an error state and tears the session down', async () => {
    const fake = createFakeTransport();
    fake.connectError = new Error('negotiation failed');
    const { result } = renderVoice({ transport: fake.transport });

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('negotiation failed');
    expect(fake.closeCalls).toBe(1);
  });

  it('surfaces a transport error event as an error state and releases the microphone', async () => {
    const { stream, stop } = createFakeStream();
    mockGetUserMedia(() => Promise.resolve(stream));
    const fake = createFakeTransport();
    const { result } = renderVoice({ transport: fake.transport });
    await act(async () => {
      await result.current.start();
    });

    act(() => {
      fake.emit({ type: 'error', message: 'connection failed' });
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('connection failed');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(fake.micStreams).toEqual([stream, null]);
    expect(fake.closeCalls).toBe(1);
  });

  it('surfaces a denied microphone permission as an error and ends the session', async () => {
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    mockGetUserMedia(() => Promise.reject(denied));
    const fake = createFakeTransport();
    const { result } = renderVoice({ transport: fake.transport });

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(VOICE_LABELS.micPermissionDenied);
    expect(fake.connectCalls).toBe(0);
    expect(fake.closeCalls).toBe(1);
  });

  it('surfaces a missing microphone as an error', async () => {
    const missing = Object.assign(new Error('Requested device not found'), {
      name: 'NotFoundError',
    });
    mockGetUserMedia(() => Promise.reject(missing));
    const fake = createFakeTransport();
    const { result } = renderVoice({ transport: fake.transport });

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(VOICE_LABELS.micUnavailable);
    expect(fake.closeCalls).toBe(1);
  });

  it('hands the microphone stream to the transport and stops it on unmount', async () => {
    const { stream, stop } = createFakeStream();
    mockGetUserMedia(() => Promise.resolve(stream));
    const fake = createFakeTransport();
    const { result, unmount } = renderVoice({ transport: fake.transport });
    await act(async () => {
      await result.current.start();
    });

    expect(fake.micStreams).toEqual([stream]);
    expect(fake.connectCalls).toBe(1);

    unmount();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(fake.micStreams).toEqual([stream, null]);
    expect(fake.closeCalls).toBe(1);
  });

  it('releases the microphone when the remote closes the session', async () => {
    const { stream, stop } = createFakeStream();
    mockGetUserMedia(() => Promise.resolve(stream));
    const fake = createFakeTransport();
    const { result } = renderVoice({ transport: fake.transport });
    await act(async () => {
      await result.current.start();
    });

    act(() => {
      fake.emit({ type: 'close' });
    });

    expect(result.current.status).toBe('idle');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(fake.closeCalls).toBe(1);
  });

  it('closes the transport once and releases state when stopped', async () => {
    const fake = createFakeTransport();
    const { result, unmount } = renderVoice({ transport: fake.transport });
    await act(async () => {
      await result.current.start();
    });

    act(() => {
      result.current.stop();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.transcripts).toEqual([]);
    expect(fake.closeCalls).toBe(1);

    unmount();
    expect(fake.closeCalls).toBe(1);
  });

  it('ignores a second start while a session is already active', async () => {
    const fake = createFakeTransport();
    const { result } = renderVoice({ transport: fake.transport });
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await result.current.start();
    });

    expect(fake.connectCalls).toBe(1);
    expect(result.current.status).toBe('listening');
  });
});
