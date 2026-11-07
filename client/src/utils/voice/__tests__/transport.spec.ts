import type { VoiceTransport, VoiceTransportEvent } from '~/components/Voice/types';
import type { WebRtcTransportOptions } from '../transport';
import { createWebRtcTransport, isRealtimeVoiceSupported, isVoiceVadSupported } from '../transport';

class FakeDataChannel {
  binaryType: BinaryType = 'arraybuffer';
  readyState: RTCDataChannelState = 'connecting';
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: unknown[] = [];
  readonly send = jest.fn((data: unknown) => {
    this.sent.push(data);
  });

  readonly close = jest.fn(() => {
    this.readyState = 'closed';
  });
}

interface FakeSender {
  track: MediaStreamTrack;
  stream: MediaStream;
  replaceTrack: jest.Mock;
}

let lastPeer: FakePeerConnection | null = null;

class FakePeerConnection {
  connectionState: RTCPeerConnectionState = 'new';
  ontrack: ((event: { track: MediaStreamTrack }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  channel: FakeDataChannel | null = null;

  readonly addTrack = jest.fn(
    (track: MediaStreamTrack, stream: MediaStream): FakeSender => ({
      track,
      stream,
      replaceTrack: jest.fn(),
    }),
  );

  readonly removeTrack = jest.fn();

  readonly close = jest.fn();

  readonly createDataChannel = jest.fn((_label: string) => {
    this.channel = new FakeDataChannel();
    return this.channel;
  });

  readonly createOffer = jest.fn(
    async (): Promise<RTCSessionDescriptionInit> => ({
      type: 'offer',
      sdp: 'fake-offer',
    }),
  );

  readonly createAnswer = jest.fn(
    async (): Promise<RTCSessionDescriptionInit> => ({
      type: 'answer',
      sdp: 'fake-answer',
    }),
  );

  readonly setLocalDescription = jest.fn(async (description: RTCSessionDescriptionInit) => {
    this.localDescription = description;
  });

  readonly setRemoteDescription = jest.fn(async (description: RTCSessionDescriptionInit) => {
    this.remoteDescription = description;
  });
}

const originalRtc = Object.getOwnPropertyDescriptor(globalThis, 'RTCPeerConnection');
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

function setRtc(value: unknown): void {
  Object.defineProperty(globalThis, 'RTCPeerConnection', {
    value,
    configurable: true,
    writable: true,
  });
}

function clearRtc(): void {
  Reflect.deleteProperty(globalThis, 'RTCPeerConnection');
}

function setFakeRtc(): void {
  setRtc(
    jest.fn(() => {
      const peer = new FakePeerConnection();
      lastPeer = peer;
      return peer;
    }),
  );
}

function setMediaDevices(value: unknown): void {
  Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true });
}

function restoreGlobals(): void {
  if (originalRtc != null) {
    Object.defineProperty(globalThis, 'RTCPeerConnection', originalRtc);
  } else {
    clearRtc();
  }
  if (originalMediaDevices != null) {
    Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  } else {
    Reflect.deleteProperty(navigator, 'mediaDevices');
  }
}

function requireTransport(options?: WebRtcTransportOptions): VoiceTransport {
  const transport = createWebRtcTransport(options);
  if (transport == null) {
    throw new Error('createWebRtcTransport returned null');
  }
  return transport;
}

function requirePeer(): FakePeerConnection {
  if (lastPeer == null) {
    throw new Error('FakePeerConnection was not constructed');
  }
  return lastPeer;
}

function requireChannel(peer: FakePeerConnection): FakeDataChannel {
  if (peer.channel == null) {
    throw new Error('no data channel was created');
  }
  return peer.channel;
}

function fakeStream(track: MediaStreamTrack): MediaStream {
  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

function fakeTrack(): MediaStreamTrack {
  return { stop: jest.fn(), kind: 'audio' } as unknown as MediaStreamTrack;
}

describe('voice capability checks', () => {
  afterEach(restoreGlobals);

  it('reports realtime voice unsupported when RTCPeerConnection is missing', () => {
    clearRtc();
    expect(isRealtimeVoiceSupported()).toBe(false);
  });

  it('reports realtime voice unsupported when getUserMedia is missing', () => {
    setFakeRtc();
    expect(isRealtimeVoiceSupported()).toBe(false);

    setMediaDevices({});
    expect(isRealtimeVoiceSupported()).toBe(false);
  });

  it('reports realtime voice supported when the peer and microphone APIs exist', () => {
    setFakeRtc();
    setMediaDevices({ getUserMedia: jest.fn() });
    expect(isRealtimeVoiceSupported()).toBe(true);
  });

  it('reports the level sampler unsupported without WebAudio', () => {
    expect(isVoiceVadSupported()).toBe(false);
  });
});

describe('createWebRtcTransport', () => {
  beforeEach(() => {
    lastPeer = null;
    setFakeRtc();
  });

  afterEach(restoreGlobals);

  it('returns null when RTCPeerConnection is unavailable', () => {
    clearRtc();
    expect(createWebRtcTransport()).toBeNull();
  });

  it('creates the voice data channel and a local offer when no signal is configured', async () => {
    const transport = requireTransport();
    const peer = requirePeer();

    const answer = await transport.connect();

    expect(peer.createDataChannel).toHaveBeenCalledWith('voice');
    expect(peer.createOffer).toHaveBeenCalledTimes(1);
    expect(peer.setLocalDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'fake-offer' });
    expect(answer).toEqual({ type: 'offer', sdp: 'fake-offer' });
  });

  it('answers an incoming offer', async () => {
    const transport = requireTransport();
    const peer = requirePeer();
    const offer = { type: 'offer' as const, sdp: 'remote-offer' };

    const answer = await transport.connect(offer);

    expect(peer.setRemoteDescription).toHaveBeenCalledWith(offer);
    expect(peer.createAnswer).toHaveBeenCalledTimes(1);
    expect(peer.setLocalDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'fake-answer' });
    expect(answer).toEqual({ type: 'answer', sdp: 'fake-answer' });
  });

  it('signalls the local offer and applies the remote answer through the signal hook', async () => {
    const remoteAnswer = { type: 'answer' as const, sdp: 'signal-answer' };
    const signal = jest.fn(async () => remoteAnswer);
    const transport = requireTransport({ signal });
    const peer = requirePeer();

    const answer = await transport.connect();

    expect(signal).toHaveBeenCalledWith({ type: 'offer', sdp: 'fake-offer' });
    expect(peer.setRemoteDescription).toHaveBeenCalledWith(remoteAnswer);
    expect(answer).toEqual(remoteAnswer);
  });

  it('attaches, replaces and detaches the microphone stream', () => {
    const transport = requireTransport();
    const peer = requirePeer();
    const track = fakeTrack();
    const otherTrack = fakeTrack();
    const stream = fakeStream(track);
    const otherStream = fakeStream(otherTrack);

    transport.setMicrophoneStream(stream);
    expect(peer.addTrack).toHaveBeenCalledWith(track, stream);

    const sender = peer.addTrack.mock.results[0].value as FakeSender;
    transport.setMicrophoneStream(otherStream);
    expect(sender.replaceTrack).toHaveBeenCalledWith(otherTrack);
    expect(peer.addTrack).toHaveBeenCalledTimes(1);

    transport.setMicrophoneStream(null);
    expect(peer.removeTrack).toHaveBeenCalledWith(sender);

    transport.setMicrophoneStream(null);
    expect(peer.removeTrack).toHaveBeenCalledTimes(1);
  });

  it('ignores a stream that carries no audio track', () => {
    const transport = requireTransport();
    const peer = requirePeer();
    const emptyStream = {
      getAudioTracks: () => [],
      getTracks: () => [],
    } as unknown as MediaStream;

    transport.setMicrophoneStream(emptyStream);

    expect(peer.addTrack).not.toHaveBeenCalled();
  });

  it('sends barge-in over the open data channel only', () => {
    const transport = requireTransport();
    const peer = requirePeer();
    const channel = requireChannel(peer);

    transport.bargeIn();
    expect(channel.sent).toEqual([]);

    channel.readyState = 'open';
    transport.bargeIn();
    expect(channel.sent).toEqual([JSON.stringify({ type: 'barge-in' })]);
  });

  it('reports connection state changes as session events', () => {
    const transport = requireTransport();
    const peer = requirePeer();
    const events: VoiceTransportEvent[] = [];
    transport.onEvent((event) => events.push(event));

    peer.connectionState = 'connected';
    peer.onconnectionstatechange?.();
    peer.connectionState = 'failed';
    peer.onconnectionstatechange?.();
    peer.connectionState = 'disconnected';
    peer.onconnectionstatechange?.();

    expect(events).toEqual([
      { type: 'open' },
      { type: 'error', message: 'Voice connection failed' },
      { type: 'close' },
    ]);
  });

  it('forwards remote tracks to subscribers until unsubscribed', () => {
    const transport = requireTransport();
    const peer = requirePeer();
    const track = fakeTrack();
    const received: MediaStreamTrack[] = [];
    const unsubscribe = transport.onTrack((incoming) => received.push(incoming));

    peer.ontrack?.({ track });
    unsubscribe();
    peer.ontrack?.({ track });

    expect(received).toEqual([track]);
  });

  it('closes the channel and peer once and stops reporting after close', () => {
    const transport = requireTransport();
    const peer = requirePeer();
    const channel = requireChannel(peer);
    const events: VoiceTransportEvent[] = [];
    transport.onEvent((event) => events.push(event));
    channel.readyState = 'open';

    transport.close();
    transport.close();

    expect(peer.close).toHaveBeenCalledTimes(1);
    expect(channel.close).toHaveBeenCalledTimes(1);

    channel.onclose?.();
    expect(events).toEqual([]);
  });
});
