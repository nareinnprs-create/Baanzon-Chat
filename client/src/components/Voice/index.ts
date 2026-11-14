/**
 * Diya Orb — the voice feature.
 *
 * A session runs entirely in the browser: Web Speech recognition captures the
 * user, each finalized utterance goes to the backend turn endpoint (the only
 * network call, via the `turn` option), and the reply is spoken through
 * `speechSynthesis`. Feature state lives in the Jotai atoms under `./atoms`,
 * strings in `./labels`, and the Web Speech plus VAD adapters in `~/utils/voice`.
 * When the browser lacks speech APIs the panel renders an explicit unsupported
 * state instead of throwing.
 *
 * ## Mounting
 *
 * ```tsx
 * import { Provider as JotaiProvider, createStore } from 'jotai';
 * import { VoicePanel } from '~/components/Voice';
 *
 * export function VoiceSlot() {
 *   return (
 *     <JotaiProvider store={createStore()}>
 *       <VoicePanel />
 *     </JotaiProvider>
 *   );
 * }
 * ```
 *
 * Pass a Jotai `Provider` with a fresh store per mount to keep sessions
 * isolated (recommended for tests and for more than one concurrent instance).
 */

export { default as VoicePanel } from './VoicePanel';
export { default as Orb } from './Orb';
export { VOICE_LABELS, formatVoiceLabel } from './labels';
export {
  appendVoiceTranscriptAtom,
  resetVoiceSessionAtom,
  upsertVoiceTranscriptAtom,
  voiceActiveAtom,
  voiceBargeInAtom,
  voiceErrorAtom,
  voiceMicLevelAtom,
  voiceMutedAtom,
  voiceStatusAtom,
  voiceTranscriptsAtom,
} from './atoms';
export type { VoicePanelProps } from './VoicePanel';
export type { VoiceLabelKey } from './labels';
export type {
  VoiceHistoryTurn,
  VoiceOptions,
  VoiceTurnFn,
  VoiceStatus,
  VoiceTranscript,
  VoiceTranscriptRole,
} from './types';
