import { Provider as JotaiProvider, createStore } from 'jotai';
import { RecoilRoot } from 'recoil';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { VoicePanelProps } from '../VoicePanel';
import { VOICE_LABELS as L } from '../labels';
import VoicePanel from '../VoicePanel';

jest.mock('~/hooks/AuthContext', () => ({
  useAuthToken: () => 'tok-123',
}));

/**
 * Renders the Diya Orb panel with microphone/recorder/audio fakes and mocked
 * server audio endpoints. Covers the unsupported, idle, active, turn and error
 * branches, and checks the turn request carries the session's Bearer token with
 * no model detail.
 */

const mockVadState = { level: 0, supported: true, dispose: jest.fn() };

jest.mock('~/utils/voice', () => ({
  isDiyaVoiceSupported: () => mockVadState.supported,
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

class FakeAudio {
  static instances: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onpause: (() => void) | null = null;
  src = '';
  constructor(_src: string) {
    FakeAudio.instances.push(this);
  }

  play(): Promise<void> {
    return Promise.resolve();
  }

  pause(): void {
    this.onpause?.();
  }
}

function installStreamFake(): void {
  const track = { stop: jest.fn(), kind: 'audio' } as unknown as MediaStreamTrack;
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: jest.fn(() => Promise.resolve(stream)) },
    configurable: true,
  });
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  (globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;
  Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:voice', configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
}

function restoreBrowser(): void {
  Reflect.deleteProperty(navigator, 'mediaDevices');
  Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'MediaRecorder');
  Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'Audio');
  Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'fetch');
}

function renderPanel(props: VoicePanelProps = {}) {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RecoilRoot>
      <JotaiProvider store={store}>{children}</JotaiProvider>
    </RecoilRoot>
  );
  return render(<VoicePanel {...props} />, { wrapper });
}

/** Routes each endpoint the session calls; `turn` decides the Diya reply. */
function mockVoiceFetch(
  turn: { status: number; body: unknown } = { status: 200, body: { reply: 'Hi, I am Diya.' } },
): jest.Mock {
  return jest.fn((url: string) => {
    if (url.includes('/api/voice/stt')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ text: 'who are you', language: 'en' }),
      });
    }
    if (url.includes('/api/diya/turn')) {
      return Promise.resolve({
        ok: turn.status >= 200 && turn.status < 300,
        status: turn.status,
        json: () => Promise.resolve(turn.body),
      });
    }
    if (url.includes('/api/voice/tts')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob(['wav'])),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
}

describe('VoicePanel', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    restoreBrowser();
    FakeRecorder.instances = [];
    FakeAudio.instances = [];
    mockVadState.level = 0;
    mockVadState.supported = true;
  });

  it('renders an explicit unsupported state when the browser lacks audio capture', () => {
    mockVadState.supported = false;
    renderPanel();

    expect(screen.getByTestId('voice-unsupported')).toBeInTheDocument();
    expect(screen.getByText(L.unsupportedTitle)).toBeInTheDocument();
    expect(screen.getByText(L.unsupportedDescription)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: L.title })).toBeInTheDocument();
    expect(screen.queryByTestId('diya-orb')).not.toBeInTheDocument();
  });

  it('renders the idle state with the orb and an empty transcript', () => {
    installStreamFake();
    renderPanel();

    expect(screen.getByTestId('voice-status')).toHaveTextContent(L.statusIdle);
    expect(screen.getByTestId('voice-transcript-empty')).toHaveTextContent(L.transcriptEmpty);
    expect(screen.getByRole('button', { name: L.start })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: L.mute })).not.toBeInTheDocument();
  });

  it('moves from idle to listening when the orb starts the session', async () => {
    installStreamFake();
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: L.start }));

    await waitFor(() =>
      expect(screen.getByTestId('voice-status')).toHaveTextContent(L.statusListening),
    );
    expect(screen.getByRole('button', { name: L.stop })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: L.mute })).toBeInTheDocument();
  });

  it('records speech, transcribes it, sends the turn with the Bearer token and speaks the reply', async () => {
    installStreamFake();
    const fetchMock = mockVoiceFetch();
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: L.start }));
    await waitFor(() =>
      expect(screen.getByTestId('voice-status')).toHaveTextContent(L.statusListening),
    );

    mockVadState.level = 0.9;
    await waitFor(() => expect(FakeRecorder.instances.length).toBe(1), { timeout: 2000 });
    // Utterances under MIN_UTTERANCE_MS are dropped as noise.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    mockVadState.level = 0;

    await waitFor(
      () =>
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/diya/turn',
          expect.objectContaining({ method: 'POST' }),
        ),
      { timeout: 4000 },
    );
    const turnCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/diya/turn') as
      | [string, RequestInit]
      | undefined;
    expect(turnCall).toBeDefined();
    const init = turnCall![1];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    expect(String(init.body)).toContain('who are you');
    expect(String(init.body)).not.toMatch(/@cf|llama|gpt/i);

    await waitFor(() => expect(screen.getByText('Hi, I am Diya.')).toBeInTheDocument(), {
      timeout: 4000,
    });
    expect(screen.getByText(L.speakerAssistant)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/voice/tts',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('surfaces a turn-endpoint failure in the error alert and keeps listening', async () => {
    installStreamFake();
    const fetchMock = mockVoiceFetch({ status: 503, body: { error: 'diya_unavailable' } });
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: L.start }));
    await waitFor(() =>
      expect(screen.getByTestId('voice-status')).toHaveTextContent(L.statusListening),
    );

    mockVadState.level = 0.9;
    await waitFor(() => expect(FakeRecorder.instances.length).toBe(1), { timeout: 2000 });
    // Utterances under MIN_UTTERANCE_MS are dropped as noise.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    mockVadState.level = 0;

    const alert = await screen.findByRole('alert', undefined, { timeout: 4000 });
    expect(alert).toHaveTextContent(L.turnUnavailable);
    await waitFor(() =>
      expect(screen.getByTestId('voice-status')).toHaveTextContent(L.statusListening),
    );
  });

  it('surfaces a denied microphone permission in the error alert', async () => {
    installStreamFake();
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: jest.fn(() => Promise.reject(denied)) },
      configurable: true,
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: L.start }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(L.micPermissionDenied);
    expect(screen.getByTestId('voice-status')).toHaveTextContent(L.statusError);
    expect(screen.getByRole('button', { name: L.retry })).toBeInTheDocument();
  });
});
