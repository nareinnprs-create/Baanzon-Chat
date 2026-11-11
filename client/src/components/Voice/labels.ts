import i18n from '~/locales/i18n';

/**
 * Voice strings for realtime voice (P5.2), promoted into
 * `client/src/locales/en/translation.json` under the `com_ui_voice_*` keys.
 * The map resolves each key through i18next at access time, so components
 * keep the plain `VOICE_LABELS.key` API while every string stays translatable.
 */
const KEYS = {
  title: 'com_ui_voice_title',
  description: 'com_ui_voice_description',
  unsupportedTitle: 'com_ui_voice_unsupported_title',
  unsupportedDescription: 'com_ui_voice_unsupported_description',
  idleTitle: 'com_ui_voice_idle_title',
  idleDescription: 'com_ui_voice_idle_description',
  start: 'com_ui_voice_start',
  stop: 'com_ui_voice_stop',
  pressToTalk: 'com_ui_voice_press_to_talk',
  releaseToStop: 'com_ui_voice_release_to_stop',
  statusIdle: 'com_ui_voice_status_idle',
  statusConnecting: 'com_ui_voice_status_connecting',
  statusListening: 'com_ui_voice_status_listening',
  statusSpeaking: 'com_ui_voice_status_speaking',
  statusMuted: 'com_ui_voice_status_muted',
  statusError: 'com_ui_voice_status_error',
  statusUnsupported: 'com_ui_voice_status_unsupported',
  mute: 'com_ui_voice_mute',
  unmute: 'com_ui_voice_unmute',
  micLevel: 'com_ui_voice_mic_level',
  bargeIn: 'com_ui_voice_barge_in',
  bargeInActive: 'com_ui_voice_barge_in_active',
  transcriptHeading: 'com_ui_voice_transcript_heading',
  transcriptEmpty: 'com_ui_voice_transcript_empty',
  speakerYou: 'com_ui_voice_speaker_you',
  speakerAssistant: 'com_ui_voice_speaker_assistant',
  errorTitle: 'com_ui_voice_error_title',
  errorDescription: 'com_ui_voice_error_description',
  micPermissionDenied: 'com_ui_voice_mic_permission_denied',
  micUnavailable: 'com_ui_voice_mic_unavailable',
  retry: 'com_ui_voice_retry',
  announceConnecting: 'com_ui_voice_announce_connecting',
  announceListening: 'com_ui_voice_announce_listening',
  announceSpeaking: 'com_ui_voice_announce_speaking',
  announceMuted: 'com_ui_voice_announce_muted',
  announceIdle: 'com_ui_voice_announce_idle',
  announceBargeIn: 'com_ui_voice_announce_barge_in',
} as const satisfies Record<string, string>;

export type VoiceLabelKey = keyof typeof KEYS;

export const VOICE_LABELS: Record<VoiceLabelKey, string> = new Proxy(KEYS, {
  get: (_, key: string) => i18n.t(KEYS[key as VoiceLabelKey]),
});

/** Interpolates i18next `{{token}}` placeholders declared in the resource strings. */
export function formatVoiceLabel(
  key: VoiceLabelKey,
  values?: Record<string, string | number>,
): string {
  return i18n.t(KEYS[key], values ?? undefined);
}
