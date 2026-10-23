/**
 * Realtime voice (P5.2) — self-contained WebRTC/VAD/barge-in client feature.
 *
 * The session is driven entirely through `VoiceTransport`; the default
 * implementation in `~/utils/voice/transport` wraps a native
 * `RTCPeerConnection`. Feature state lives in the Jotai atoms under `./atoms`,
 * strings in `./labels`, and the pure VAD plus browser adapters in
 * `~/utils/voice`. When WebRTC/microphone APIs are missing the panel renders an
 * explicit unsupported state instead of throwing.
 *
 * ## Mounting
 *
 * ```tsx
 * import { Provider as JotaiProvider, createStore } from 'jotai';
 * import { VoicePanel, createWebRtcTransport } from '~/components/Voice';
 *
 * export function VoiceSlot() {
 *   const transport = createWebRtcTransport({ rtcConfig: undefined });
 *   return (
 *     <JotaiProvider store={createStore()}>
 *       <VoicePanel transport={transport} mode="toggle" />
 *     </JotaiProvider>
 *   );
 * }
 * ```
 *
 * `createWebRtcTransport` returns `null` when WebRTC is unavailable, in which
 * case `VoicePanel` renders its unsupported state. Pass a Jotai `Provider` with
 * a fresh store per mount to keep sessions isolated (recommended for tests and
 * for more than one concurrent instance).
 */

export { default as VoicePanel } from './VoicePanel';
export { default as VoiceButton } from './VoiceButton';
export { VOICE_LABELS, formatVoiceLabel } from './labels';
export {
  appendVoiceTranscriptAtom,
  resetVoiceSessionAtom,
  voiceActiveAtom,
  voiceBargeInAtom,
  voiceErrorAtom,
  voiceMicLevelAtom,
  voiceMutedAtom,
  voiceStatusAtom,
  voiceTranscriptsAtom,
} from './atoms';
export {
  createWebRtcTransport,
  isRealtimeVoiceSupported,
  isVoiceVadSupported,
} from '~/utils/voice';
export type { VoicePanelProps } from './VoicePanel';
export type { VoiceButtonProps } from './VoiceButton';
export type { VoiceLabelKey } from './labels';
export type {
  VoiceOptions,
  VoiceSignalFn,
  VoiceStatus,
  VoiceTranscript,
  VoiceTranscriptRole,
  VoiceTransport,
  VoiceTransportEvent,
} from './types';
