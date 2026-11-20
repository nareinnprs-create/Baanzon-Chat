import { Provider as JotaiProvider, createStore } from 'jotai';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import useDiyaVoice from '~/hooks/useDiyaVoice';

/**
 * Drives the Diya Orb state machine with fakes for the microphone, recorder,
 * server STT/TTS fetches and audio playback. The VAD interval reads the mocked
 * sampler level, which starts and stops recording; the transcript drives the
 * turn seam; the reply is synthesized and played by the server-audio path.
 */

const mockVadState = {
  level: 0,
  dispose: jest.fn(),
};

jest.mock('~/utils/voice', () => ({
  isDiyaVoiceSupported: () => true,
  createWebAudioVadSampler: () => ({
    sampler: { sample: () => mockVadState.level, dispose: mockVadState.dispose },
    close: () => undefined,
  }),
  createVoiceActivityDetector: () => ({
    push: (level: number) => (level > 0.5 ? 'speech-start' : 'speech-end'),
  }),
}));

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(
    public stream: unknown,
    public options?: unknown,
  ) {
    FakeRecorder.instances.push(this);
  }

  static isTypeSupported(): boolean {
    return true;
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    // The session ignores recordings under 1200 bytes as noise.
    this.ondataavailable?.({
      data: new Blob([new Uint8Array(4096)], { type: 'audio/webm' }),
    });
    this.onstop?.();
  }
}

const audioState = { instances: [] as FakeAudio[] };

class FakeAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onpause: (() => void) | null = null;
  src = '';
  constructor(_src: string) {
    audioState.instances.push(this);
  }

  play(): Promise<void> {
    return Promise.resolve();
  }

  pause(): void {
    this.onpause?.();
  }
}

function installBrowserFakes(): void {
  const track = { stop: jest.fn() };
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: jest.fn(() =>
        Promise.resolve({ getTracks: () => [track], getAudioTracks: () => [track] }),
      ),
    },
    configurable: true,
  });
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  (globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;
  Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:voice', configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
}

function renderVoice(overrides: Parameters<typeof useDiyaVoice>[0] = {}) {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <JotaiProvider store={store}>{children}</JotaiProvider>
  );
  const turn = jest.fn(() => Promise.resolve('Hello from Diya.'));
  const view = renderHook(() => useDiyaVoice({ turn, token: 'tok', ...overrides }), { wrapper });
  return { ...view, turn };
}

function mockFetch(): jest.Mock {
  return jest.fn((url: string) => {
    if (url.includes('/api/voice/stt')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ text: 'hello diya', language: 'en' }),
      });
    }
    if (url.includes('/api/voice/tts')) {
      return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['wav'])) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
}

describe('useDiyaVoice (server audio)', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    installBrowserFakes();
    FakeRecorder.instances = [];
    audioState.instances = [];
    mockVadState.level = 0;
    fetchMock = mockFetch();
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('starts a listening session with the microphone', async () => {
    const { result } = renderVoice();
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('listening');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
  });

  it('stops the sentence loop when the user barges in mid-reply', async () => {
    const { result } = renderVoice({
      turn: jest.fn(() => Promise.resolve('First part. Second part.')),
    });
    await act(async () => {
      await result.current.start();
    });

    mockVadState.level = 0.9;
    await waitFor(() => expect(FakeRecorder.instances.length).toBe(1), { timeout: 2000 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    mockVadState.level = 0;

    // First sentence is playing; interrupt before the second is synthesized.
    await waitFor(() => expect(audioState.instances.length).toBe(1), { timeout: 4000 });
    mockVadState.level = 0.9;
    await waitFor(() => expect(result.current.status).toBe('listening'), { timeout: 2000 });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    const ttsCalls = fetchMock.mock.calls.filter(([url]) => String(url) === '/api/voice/tts');
    expect(ttsCalls.length).toBe(1);
  });

  it('stops the session and releases the microphone', async () => {
    const { result } = renderVoice();
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.stop();
    });
    expect(result.current.status).toBe('idle');
  });
});
