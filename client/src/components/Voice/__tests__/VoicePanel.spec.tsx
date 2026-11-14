import { Provider as JotaiProvider, createStore } from 'jotai';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { VoicePanelProps } from '../VoicePanel';
import { VOICE_LABELS as L } from '../labels';
import VoicePanel from '../VoicePanel';

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ token: 'tok-123' }),
}));

/**
 * Renders the Diya Orb panel with Web Speech fakes and a mocked turn endpoint.
 * Covers the unsupported, idle, active, turn and error branches, and checks
 * the turn request carries the session's Bearer token with no model detail.
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
  started = false;

  start(): void {
    if (this.started) {
      throw new DOMException('already started', 'InvalidStateError');
    }
    this.started = true;
  }

  stop(): void {
    this.started = false;
    this.onend?.();
  }

  abort(): void {
    this.started = false;
  }

  emit(result: FakeResult, index = 0): void {
    const item = { transcript: result.transcript };
    this.onresult?.({
      resultIndex: index,
      results: { length: index + 1, [index]: { isFinal: result.isFinal, 0: item, length: 1 } },
    });
  }
}

interface SpeechFakes {
  recognition: FakeRecognition;
  spoken: Array<{ onstart?: () => void; onend?: () => void; onerror?: () => void }>;
}

function installSpeechFakes(): SpeechFakes {
  const recognition = new FakeRecognition();
  const spoken: Array<{ onstart?: () => void; onend?: () => void; onerror?: () => void }> = [];
  Object.defineProperty(window, 'SpeechRecognition', {
    value: jest.fn(() => recognition),
    configurable: true,
  });
  Object.defineProperty(window, 'speechSynthesis', {
    value: {
      speak: (utterance: { onstart?: () => void; onend?: () => void; onerror?: () => void }) => {
        spoken.push(utterance);
      },
      cancel: jest.fn(),
      getVoices: () => [],
    },
    configurable: true,
  });
  (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
    text: string;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  };
  return { recognition, spoken };
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
}

function restoreBrowser(): void {
  Reflect.deleteProperty(window, 'SpeechRecognition');
  Reflect.deleteProperty(window, 'webkitSpeechRecognition');
  Reflect.deleteProperty(window, 'speechSynthesis');
  Reflect.deleteProperty(window, 'SpeechSynthesisUtterance');
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  if (descriptor?.configurable) {
    Reflect.deleteProperty(navigator, 'mediaDevices');
  }
}

function renderPanel(props: VoicePanelProps = {}) {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <JotaiProvider store={store}>{children}</JotaiProvider>
  );
  return render(<VoicePanel {...props} />, { wrapper });
}

function mockTurnEndpoint(status: number, body: unknown): jest.Mock {
  // A plain object: jsdom does not ship the `Response` constructor.
  return jest.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

function stubFetch(mock: jest.Mock): void {
  // jsdom has no global `fetch` and this jest lacks `stubGlobal`, so assign directly.
  (globalThis as unknown as { fetch: unknown }).fetch = mock;
}

describe('VoicePanel', () => {
  afterEach(restoreBrowser);
  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'fetch');
  });

  it('renders an explicit unsupported state when the browser lacks the speech APIs', () => {
    renderPanel();

    expect(screen.getByTestId('voice-unsupported')).toBeInTheDocument();
    expect(screen.getByText(L.unsupportedTitle)).toBeInTheDocument();
    expect(screen.getByText(L.unsupportedDescription)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: L.title })).toBeInTheDocument();
    expect(screen.queryByTestId('diya-orb')).not.toBeInTheDocument();
  });

  it('renders the idle state with the orb and an empty transcript', () => {
    installSpeechFakes();
    installStreamFake();
    renderPanel();

    expect(screen.getByTestId('voice-status')).toHaveTextContent(L.statusIdle);
    expect(screen.getByTestId('voice-transcript-empty')).toHaveTextContent(L.transcriptEmpty);
    expect(screen.getByRole('button', { name: L.start })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: L.mute })).not.toBeInTheDocument();
  });

  it('moves from idle to listening when the orb starts the session', async () => {
    installSpeechFakes();
    installStreamFake();
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: L.start }));

    await waitFor(() =>
      expect(screen.getByTestId('voice-status')).toHaveTextContent(L.statusListening),
    );
    expect(screen.getByRole('button', { name: L.stop })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: L.mute })).toBeInTheDocument();
  });

  it('sends a recognized utterance to the turn endpoint with the Bearer token', async () => {
    const fakes = installSpeechFakes();
    installStreamFake();
    const fetchMock = mockTurnEndpoint(200, { reply: 'Hi, I am Diya.' });
    stubFetch(fetchMock);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: L.start }));
    await waitFor(() =>
      expect(screen.getByTestId('voice-status')).toHaveTextContent(L.statusListening),
    );

    act(() => fakes.recognition.emit({ isFinal: true, transcript: 'who are you' }));
    await waitFor(() =>
      expect(screen.getByTestId('voice-status')).toHaveTextContent(L.statusThinking),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe('/api/diya/turn');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    expect(String(init.body)).toContain('who are you');
    expect(String(init.body)).not.toMatch(/@cf|llama|gpt/i);

    // The reply is appended to the transcript and spoken through synthesis.
    act(() => fakes.spoken[0]?.onstart?.());
    await waitFor(() =>
      expect(screen.getByTestId('voice-status')).toHaveTextContent(L.statusSpeaking),
    );
    expect(screen.getByText('Hi, I am Diya.')).toBeInTheDocument();
    expect(screen.getByText(L.speakerAssistant)).toBeInTheDocument();
  });

  it('surfaces a turn-endpoint failure in the error alert and keeps listening', async () => {
    const fakes = installSpeechFakes();
    installStreamFake();
    stubFetch(mockTurnEndpoint(503, { error: 'diya_unavailable' }));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: L.start }));
    await waitFor(() =>
      expect(screen.getByTestId('voice-status')).toHaveTextContent(L.statusListening),
    );

    act(() => fakes.recognition.emit({ isFinal: true, transcript: 'hello' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(L.turnUnavailable);
    await waitFor(() =>
      expect(screen.getByTestId('voice-status')).toHaveTextContent(L.statusListening),
    );
  });

  it('surfaces a denied microphone permission in the error alert', async () => {
    installSpeechFakes();
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
