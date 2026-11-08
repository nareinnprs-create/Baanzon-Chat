import { Provider as JotaiProvider, createStore } from 'jotai';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { VoiceTransport, VoiceTransportEvent } from '../types';
import type { VoicePanelProps } from '../VoicePanel';
import { VOICE_LABELS as L } from '../labels';
import VoicePanel from '../VoicePanel';

function createFakeTransport(): VoiceTransport {
  const trackListeners = new Set<(track: MediaStreamTrack) => void>();
  const eventListeners = new Set<(event: VoiceTransportEvent) => void>();
  return {
    connect: async () => undefined,
    setMicrophoneStream: jest.fn(),
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
    bargeIn: jest.fn(),
    close: jest.fn(),
  };
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

function restoreMediaDevices(): void {
  if (originalMediaDevices != null) {
    Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
    return;
  }
  Reflect.deleteProperty(navigator, 'mediaDevices');
}

function renderPanel(props: VoicePanelProps = {}) {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <JotaiProvider store={store}>{children}</JotaiProvider>
  );
  return render(<VoicePanel {...props} />, { wrapper });
}

describe('VoicePanel', () => {
  afterEach(restoreMediaDevices);

  it('renders an explicit unsupported state when the browser lacks realtime APIs', () => {
    renderPanel();

    expect(screen.getByTestId('voice-unsupported')).toBeInTheDocument();
    expect(screen.getByText(L.unsupportedTitle)).toBeInTheDocument();
    expect(screen.getByText(L.unsupportedDescription)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: L.title })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: L.start })).not.toBeInTheDocument();
  });

  it('renders the idle state with a start action and an empty transcript', async () => {
    renderPanel({ transport: createFakeTransport() });

    expect(screen.getByRole('status')).toHaveTextContent(L.statusIdle);
    expect(screen.getByTestId('voice-transcript-empty')).toHaveTextContent(L.transcriptEmpty);
    expect(screen.getByRole('button', { name: L.start })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: L.mute })).not.toBeInTheDocument();
  });

  it('moves from idle to connecting to listening when the session starts', async () => {
    renderPanel({ transport: createFakeTransport() });

    fireEvent.click(screen.getByRole('button', { name: L.start }));

    expect(screen.getByTestId('voice-status')).toHaveTextContent(L.statusConnecting);

    await waitFor(() =>
      expect(screen.getByTestId('voice-status')).toHaveTextContent(L.statusListening),
    );

    expect(screen.getByRole('button', { name: L.mute })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: L.stop })).toBeInTheDocument();
  });

  it('surfaces a transport failure as an error state with a retry action', async () => {
    const transport: VoiceTransport = {
      connect: async () => {
        throw new Error('no route to the session');
      },
      setMicrophoneStream: jest.fn(),
      onTrack: () => () => undefined,
      onEvent: () => () => undefined,
      bargeIn: jest.fn(),
      close: jest.fn(),
    };

    renderPanel({ transport });

    fireEvent.click(screen.getByRole('button', { name: L.start }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('no route to the session');
    expect(screen.getByRole('button', { name: L.retry })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(L.statusError);
  });

  it('surfaces a denied microphone permission in the error alert', async () => {
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    mockGetUserMedia(() => Promise.reject(denied));

    renderPanel({ transport: createFakeTransport() });

    fireEvent.click(screen.getByRole('button', { name: L.start }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(L.micPermissionDenied);
    expect(screen.getByRole('status')).toHaveTextContent(L.statusError);
  });
});
