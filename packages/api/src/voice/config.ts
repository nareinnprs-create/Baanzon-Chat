import type { VoiceCatalogEntry, VoiceConfig } from './types';
import { VOICE_TIER_MINUTES } from './caps';

/**
 * Voice defaults and the client-facing config payload. Model identities
 * never leave the server: the client gets voice labels and remaining time,
 * nothing else.
 */

/** System prompt steering spoken replies: short, no markup, spoken numbers. */
export const VOICE_STYLE =
  'You are Baanzon, a warm voice assistant. Reply in 1-3 short conversational ' +
  'sentences. No markdown, no lists, no emoji. Spell out numbers, symbols and ' +
  'URLs the way a person would say them aloud.';

/**
 * Curated aura-1 speakers. Speaker ids are provider vocabulary, not model
 * identities; labels stay generic ("Voice 1..6") so the UI leaks nothing.
 * Speaker param acceptance on the aura WS is unverified — v1 sends it and
 * falls back to the default voice if CF ignores it.
 */
export const VOICE_SPEAKERS: VoiceCatalogEntry[] = [
  { id: 'asteria', label: 'Voice 1' },
  { id: 'luna', label: 'Voice 2' },
  { id: 'stella', label: 'Voice 3' },
  { id: 'orion', label: 'Voice 4' },
  { id: 'arcas', label: 'Voice 5' },
  { id: 'hermes', label: 'Voice 6' },
];

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  enabled: true,
  sttModel: '@cf/deepgram/flux',
  ttsModel: '@cf/deepgram/aura-1',
  llmModel: '@cf/meta/llama-3.1-8b-instruct-fp8',
  voiceStyle: VOICE_STYLE,
  voices: VOICE_SPEAKERS,
  defaultMode: 'hands-free',
  captionsDefault: true,
  maxContextTurns: 12,
  maxTokens: 300,
  temperature: 0.7,
  eotThreshold: 0.7,
  eotTimeoutMs: 2500,
  tierMinutes: VOICE_TIER_MINUTES,
};

/** Operator overrides from the `voice:` section of baanzon.yaml. */
export interface VoiceYamlConfig {
  enabled?: boolean;
  defaultMode?: 'hands-free' | 'hold-to-talk';
  captionsDefault?: boolean;
  maxContextTurns?: number;
  eotThreshold?: number;
  eotTimeoutMs?: number;
  eagerEotThreshold?: number;
}

export function buildVoiceConfig(yaml?: VoiceYamlConfig | null): VoiceConfig {
  return { ...DEFAULT_VOICE_CONFIG, ...yaml };
}

/** Client payload: capability + quota only. No provider or model ids. */
export function voiceClientConfig(config: VoiceConfig, remaining: number) {
  return {
    enabled: config.enabled,
    voices: config.voices,
    defaultMode: config.defaultMode,
    captionsDefault: config.captionsDefault,
    remainingSeconds: remaining,
  };
}
