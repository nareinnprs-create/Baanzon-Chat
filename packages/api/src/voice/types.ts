/**
 * Voice Mode (CF cascade): shared types + wire protocol.
 *
 * Client ⇄ pod is one WebSocket (`/api/voice/realtime`): JSON control frames
 * plus raw binary PCM frames. The pod fans out to streaming providers
 * (flux STT, an OpenAI-compatible LLM, aura TTS) and never exposes their
 * identities to the client.
 */

export type VoiceState = 'listening' | 'thinking' | 'speaking';
export type VoiceTier = 'free' | 'lite' | 'pro' | 'enterprise';
export type VoiceMode = 'hands-free' | 'hold-to-talk';

/** Mic capture format sent upstream by the browser (linear16 mono LE). */
export const CLIENT_SAMPLE_RATE = 16000;
/** Playback format aura streams downstream (linear16 mono LE). */
export const PLAYBACK_SAMPLE_RATE = 24000;

export interface VoiceTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** Thread snapshot injected into the voice session at start. */
export interface VoiceThreadContext {
  instructions?: string;
  turns: VoiceTurn[];
  parentMessageId?: string | null;
}

export interface VoiceCatalogEntry {
  /** Provider speaker id; not a model identity. */
  id: string;
  label: string;
}

export interface VoiceConfig {
  enabled: boolean;
  sttModel: string;
  ttsModel: string;
  llmModel: string;
  /** System prompt steering spoken replies. */
  voiceStyle: string;
  voices: VoiceCatalogEntry[];
  defaultMode: VoiceMode;
  captionsDefault: boolean;
  maxContextTurns: number;
  maxTokens: number;
  temperature: number;
  eotThreshold: number;
  eotTimeoutMs: number;
  tierMinutes: Record<VoiceTier, number>;
}

/** JSON control frames client → pod. Mic audio travels as binary frames. */
export type ClientVoiceMessage =
  | { type: 'start'; conversationId?: string; voice?: string }
  | { type: 'barge-in' }
  | { type: 'mute'; muted: boolean }
  | { type: 'stop' }
  | { type: 'ping' };

/** JSON control frames pod → client. Reply audio travels as binary frames. */
export type ServerVoiceMessage =
  | {
      type: 'ready';
      voices: VoiceCatalogEntry[];
      mode: VoiceMode;
      captions: boolean;
      remainingSeconds: number;
    }
  | { type: 'state'; state: VoiceState }
  | { type: 'user-transcript'; text: string; final: boolean }
  | { type: 'assistant-transcript'; text: string }
  | { type: 'interrupted'; text: string }
  | { type: 'error'; code: 'cap' | 'auth' | 'server'; message: string }
  | { type: 'pong' };

export interface VoiceUpgradeAuth {
  userId: string;
}
