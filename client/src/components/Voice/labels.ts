/**
 * Feature-local English labels for realtime voice (P5.2).
 *
 * These are the strings with no shared `com_ui_*` key yet. Each entry is meant
 * to be promoted into `client/src/locales/en/translation.json` under the
 * suggested key in its doc comment, after which this map is replaced by
 * `useLocalize()`.
 *
 * TODO(i18n): promote every key below into client/src/locales/en/translation.json
 * (suggested prefix `com_ui_voice_`) and replace this map with `useLocalize()`.
 */
export const VOICE_LABELS = {
  /** com_ui_voice_title */
  title: 'Voice',
  /** com_ui_voice_description */
  description: 'Talk to the assistant in real time.',
  /** com_ui_voice_unsupported_title */
  unsupportedTitle: 'Voice unavailable',
  /** com_ui_voice_unsupported_description */
  unsupportedDescription:
    'This browser is missing the WebRTC or microphone APIs needed for realtime voice.',
  /** com_ui_voice_idle_title */
  idleTitle: 'Ready when you are',
  /** com_ui_voice_idle_description */
  idleDescription: 'Start a session to talk to the assistant.',
  /** com_ui_voice_start */
  start: 'Start voice session',
  /** com_ui_voice_stop */
  stop: 'End call',
  /** com_ui_voice_press_to_talk */
  pressToTalk: 'Hold to talk',
  /** com_ui_voice_release_to_stop */
  releaseToStop: 'Release to stop',
  /** com_ui_voice_status_idle */
  statusIdle: 'Ready',
  /** com_ui_voice_status_connecting */
  statusConnecting: 'Connecting',
  /** com_ui_voice_status_listening */
  statusListening: 'Listening',
  /** com_ui_voice_status_speaking */
  statusSpeaking: 'Assistant speaking',
  /** com_ui_voice_status_muted */
  statusMuted: 'Microphone muted',
  /** com_ui_voice_status_error */
  statusError: 'Session error',
  /** com_ui_voice_status_unsupported */
  statusUnsupported: 'Unsupported',
  /** com_ui_voice_mute */
  mute: 'Mute microphone',
  /** com_ui_voice_unmute */
  unmute: 'Unmute microphone',
  /** com_ui_voice_mic_level */
  micLevel: 'Microphone level',
  /** com_ui_voice_barge_in */
  bargeIn: 'Interrupt',
  /** com_ui_voice_barge_in_active */
  bargeInActive: 'Interrupted — go ahead',
  /** com_ui_voice_transcript_heading */
  transcriptHeading: 'Transcript',
  /** com_ui_voice_transcript_empty */
  transcriptEmpty: 'The transcript will appear here as you speak.',
  /** com_ui_voice_speaker_you */
  speakerYou: 'You',
  /** com_ui_voice_speaker_assistant */
  speakerAssistant: 'Assistant',
  /** com_ui_voice_error_title */
  errorTitle: 'Voice session failed',
  /** com_ui_voice_error_description */
  errorDescription: 'The session ended unexpectedly.',
  /** com_ui_voice_mic_permission_denied */
  micPermissionDenied:
    'Microphone access was denied. Allow microphone access in your browser settings and try again.',
  /** com_ui_voice_mic_unavailable */
  micUnavailable: 'No microphone was found. Connect one and try again.',
  /** com_ui_voice_retry */
  retry: 'Try again',
  /** com_ui_voice_announce_connecting */
  announceConnecting: 'Connecting the voice session.',
  /** com_ui_voice_announce_listening */
  announceListening: 'Listening. Speak when ready.',
  /** com_ui_voice_announce_speaking */
  announceSpeaking: 'The assistant is speaking.',
  /** com_ui_voice_announce_muted */
  announceMuted: 'Microphone muted.',
  /** com_ui_voice_announce_idle */
  announceIdle: 'Voice session ended.',
  /** com_ui_voice_announce_barge_in */
  announceBargeIn: 'You interrupted the assistant.',
} as const;

export type VoiceLabelKey = keyof typeof VOICE_LABELS;

/** Interpolates `{token}` placeholders; a drop-in for the future `useLocalize()`. */
export function formatVoiceLabel(
  key: VoiceLabelKey,
  values?: Record<string, string | number>,
): string {
  const template: string = VOICE_LABELS[key];
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, token: string) =>
    values[token] === undefined ? match : String(values[token]),
  );
}
