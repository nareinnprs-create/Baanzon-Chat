/**
 * Native WebRTC implementation of {@link VoiceTransport}, plus the capability
 * checks the feature uses to decide between a live session and its unsupported
 * state. Every browser global is guarded, so importing this module under jsdom
 * is safe and constructing a transport simply returns `null`.
 */

import type { VoiceSignalFn, VoiceTransport, VoiceTransportEvent } from '~/components/Voice/types';

type RtcConstructor = typeof RTCPeerConnection;

function getRtcConstructor(): RtcConstructor | null {
  return typeof RTCPeerConnection === 'undefined' ? null : RTCPeerConnection;
}

/** `true` when this environment can open a peer connection and reach a microphone. */
export function isRealtimeVoiceSupported(): boolean {
  if (getRtcConstructor() == null) {
    return false;
  }
  if (typeof navigator === 'undefined' || navigator.mediaDevices == null) {
    return false;
  }
  return typeof navigator.mediaDevices.getUserMedia === 'function';
}

/** `true` when a microphone level sampler can be built (local VAD and the meter). */
export function isVoiceVadSupported(): boolean {
  return typeof AudioContext !== 'undefined';
}

export interface WebRtcTransportOptions {
  rtcConfig?: RTCConfiguration;
  /** Signaling hook; without one the transport negotiates locally only. */
  signal?: VoiceSignalFn;
}

/**
 * Builds a {@link VoiceTransport} over a real `RTCPeerConnection`, or `null`
 * when WebRTC is unavailable. Remote audio arrives through {@link VoiceTransport.onTrack};
 * control frames (barge-in) travel over a `voice` data channel.
 */
export function createWebRtcTransport(options: WebRtcTransportOptions = {}): VoiceTransport | null {
  const Rtc = getRtcConstructor();
  if (Rtc == null) {
    return null;
  }

  const trackListeners = new Set<(track: MediaStreamTrack) => void>();
  const eventListeners = new Set<(event: VoiceTransportEvent) => void>();
  let closed = false;

  const emit = (event: VoiceTransportEvent): void => {
    eventListeners.forEach((listener) => listener(event));
  };

  const peer = new Rtc(options.rtcConfig);

  let channel: RTCDataChannel | null = null;
  try {
    channel = peer.createDataChannel('voice');
    channel.binaryType = 'arraybuffer';
    channel.onclose = () => {
      if (!closed) {
        emit({ type: 'close' });
      }
    };
    channel.onerror = () => emit({ type: 'error', message: 'Voice data channel error' });
  } catch {
    channel = null;
  }

  peer.ontrack = (event: RTCTrackEvent) => {
    trackListeners.forEach((listener) => listener(event.track));
  };

  peer.onconnectionstatechange = () => {
    const state = peer.connectionState;
    if (state === 'connected') {
      emit({ type: 'open' });
    } else if (state === 'failed') {
      emit({ type: 'error', message: 'Voice connection failed' });
    } else if ((state === 'disconnected' || state === 'closed') && !closed) {
      emit({ type: 'close' });
    }
  };

  const sendControl = (payload: Record<string, string>): void => {
    if (channel != null && channel.readyState === 'open') {
      channel.send(JSON.stringify(payload));
    }
  };

  let localSender: RTCRtpSender | null = null;

  const attachStream = (stream: MediaStream | null): void => {
    try {
      if (stream == null) {
        if (localSender != null) {
          peer.removeTrack(localSender);
          localSender = null;
        }
        return;
      }
      const [track] = stream.getAudioTracks();
      if (track == null) {
        return;
      }
      if (localSender == null) {
        localSender = peer.addTrack(track, stream);
      } else {
        void localSender.replaceTrack(track);
      }
    } catch {
      /* A closed peer rejects track changes; the session is ending anyway. */
    }
  };

  return {
    async connect(offer) {
      if (offer != null) {
        await peer.setRemoteDescription(offer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        return answer;
      }
      const localOffer = await peer.createOffer();
      await peer.setLocalDescription(localOffer);
      if (options.signal != null) {
        const remoteAnswer = await options.signal(localOffer);
        await peer.setRemoteDescription(remoteAnswer);
        return remoteAnswer;
      }
      return localOffer;
    },
    setMicrophoneStream: attachStream,
    onTrack(listener) {
      trackListeners.add(listener);
      return () => {
        trackListeners.delete(listener);
      };
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    bargeIn() {
      sendControl({ type: 'barge-in' });
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      try {
        channel?.close();
      } catch {
        /* Channel may already be gone. */
      }
      try {
        peer.close();
      } catch {
        /* Peer may already be gone. */
      }
      trackListeners.clear();
      eventListeners.clear();
    },
  };
}
