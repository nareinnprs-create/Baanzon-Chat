/**
 * Shared vocabulary for the realtime voice feature (P5.2).
 *
 * The session is deliberately transport-agnostic: {@link VoiceTransport} is the
 * only seam to the network, so the hook and the panels are written against it
 * and a fake implementation drives the tests. The default implementation over
 * native `RTCPeerConnection` lives in `~/utils/voice/transport`.
 */

import type { VadOptions } from '~/utils/voice/vad';

/** Lifecycle of a voice session. */
export type VoiceStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'muted'
  | 'error'
  | 'unsupported';

/** Who produced a transcript line. */
export type VoiceTranscriptRole = 'user' | 'assistant';

/** One line of the running transcript. `final` distinguishes interim from settled text. */
export interface VoiceTranscript {
  id: string;
  role: VoiceTranscriptRole;
  text: string;
  final: boolean;
  at: number;
}

/**
 * Sends a locally created SDP offer and resolves the remote answer. The
 * transport calls this; a self-contained integration supplies its own network
 * call.
 */
export type VoiceSignalFn = (
  offer: RTCSessionDescriptionInit,
) => Promise<RTCSessionDescriptionInit>;

/** Everything the transport can report asynchronously. */
export type VoiceTransportEvent =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'error'; message: string }
  | { type: 'assistant-speaking'; speaking: boolean }
  | { type: 'transcript'; transcript: VoiceTranscript };

/**
 * The network seam. A real implementation negotiates WebRTC and carries the
 * microphone track on the peer connection; a fake one can be a plain object,
 * which is what the lifecycle tests use.
 */
export interface VoiceTransport {
  /**
   * Negotiates the session. With an `offer` the transport answers it; without
   * one it creates its own offer (optionally signalling it through
   * {@link VoiceSignalFn}) and resolves the negotiated answer. Call
   * {@link VoiceTransport.setMicrophoneStream} first so the initial offer
   * already carries the microphone track.
   */
  connect(offer?: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit | void>;
  /**
   * Attaches the microphone stream to the session, replacing any previous one;
   * `null` detaches it. The hook calls this after `getUserMedia` resolves and
   * again while tearing down.
   */
  setMicrophoneStream(stream: MediaStream | null): void;
  /** Subscribes to remote audio tracks; returns an unsubscribe. */
  onTrack(listener: (track: MediaStreamTrack) => void): () => void;
  /** Subscribes to session events; returns an unsubscribe. */
  onEvent(listener: (event: VoiceTransportEvent) => void): () => void;
  /** Signals the remote to stop its current utterance (barge-in). */
  bargeIn(): void;
  /** Tears the session down; safe to call more than once. */
  close(): void;
}

/** Options accepted by {@link useRealtimeVoice} and `VoicePanel`. */
export interface VoiceOptions {
  /**
   * A ready transport. When supplied it also proves the environment is usable.
   * A session that ends closes it, so a transport here must tolerate
   * `connect()` after `close()` for the error-retry path to work; pass
   * `createTransport` for transports that are single-use.
   */
  transport?: VoiceTransport | null;
  /** Builds a transport when none is injected; `null` means unsupported. */
  createTransport?: (config?: RTCConfiguration) => VoiceTransport | null;
  /** Passed to the default WebRTC transport. */
  rtcConfig?: RTCConfiguration;
  /** VAD tuning; see {@link VadOptions}. */
  vad?: VadOptions;
  /** Level-sampling interval for the meter and VAD, in milliseconds. Default `100`. */
  tickMs?: number;
  /** Starts the session as soon as a supported environment is detected. */
  autoStart?: boolean;
  /** Called for each transcript line the transport reports. */
  onTranscript?: (transcript: VoiceTranscript) => void;
}
