/**
 * Shared vocabulary for the Diya Orb voice feature.
 *
 * The session runs entirely in the browser: Web Speech recognition captures
 * the user, each finalized utterance goes to the backend turn endpoint, and
 * the reply is spoken through `speechSynthesis`. There is no WebRTC seam
 * anymore — the only network call is {@link VoiceTurnFn}, which the hook and
 * the panels are written against.
 */

import type { VadOptions } from '~/utils/voice/vad';

/** Lifecycle of a voice session. */
export type VoiceStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
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

/** One prior turn sent to the backend so replies keep their context. */
export interface VoiceHistoryTurn {
  role: VoiceTranscriptRole;
  content: string;
}

/**
 * The conversation seam. Receives the user's finalized text plus the settled
 * history so far, resolves the assistant's reply text. Rejecting fails the
 * turn; the hook surfaces the failure and returns to listening.
 */
export type VoiceTurnFn = (
  text: string,
  history: VoiceHistoryTurn[],
  signal: AbortSignal,
) => Promise<string>;

/** Options accepted by {@link useDiyaVoice} and `VoicePanel`. */
export interface VoiceOptions {
  /** The conversation seam; the panel supplies the authenticated default. */
  turn?: VoiceTurnFn;
  /** VAD tuning; see {@link VadOptions}. */
  vad?: VadOptions;
  /** Level-sampling interval for the meter and VAD, in milliseconds. Default `100`. */
  tickMs?: number;
  /** Starts the session as soon as a supported environment is detected. */
  autoStart?: boolean;
  /** Called for each transcript line the session produces. */
  onTranscript?: (transcript: VoiceTranscript) => void;
}

/* ── Realtime voice (server cascade) ────────────────────────────────────
 * One WebSocket to `/api/voice/realtime`: JSON control frames plus raw
 * binary PCM frames (16 kHz up, 24 kHz down). The server never exposes
 * provider identities — voices arrive as generic catalog entries.
 */

/** A selectable server voice. Ids are generic catalog vocabulary. */
export interface VoiceCatalogEntry {
  id: string;
  label: string;
}

/** Server → client control frames; reply audio travels as binary frames. */
export type RealtimeServerMessage =
  | {
      type: 'ready';
      voices: VoiceCatalogEntry[];
      mode: 'hands-free' | 'hold-to-talk';
      captions: boolean;
      remainingSeconds: number;
    }
  | { type: 'state'; state: 'listening' | 'thinking' | 'speaking' }
  | { type: 'user-transcript'; text: string; final: boolean }
  | { type: 'assistant-transcript'; text: string }
  | { type: 'interrupted'; text: string }
  | { type: 'error'; code: 'cap' | 'auth' | 'server'; message: string }
  | { type: 'pong' };

/** Client → server control frames; mic audio travels as binary frames. */
export type RealtimeClientMessage =
  | { type: 'start'; voice?: string }
  | { type: 'barge-in' }
  | { type: 'mute'; muted: boolean }
  | { type: 'stop' }
  | { type: 'ping' };
