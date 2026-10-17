import { atom } from 'jotai';
import type { VoiceStatus, VoiceTranscript } from './types';

/**
 * Feature-owned Jotai state for realtime voice.
 *
 * The session both writes and reads this state, so it lives with the feature
 * and never in `~/store`. `useRealtimeVoice` owns the writes; the panels read
 * through the narrow atoms below so each subscribes to only what it renders.
 * Mount the feature under a fresh `<Provider store={createStore()}>` for
 * isolated state per session.
 */

/** The lifecycle status of the current session. */
export const voiceStatusAtom = atom<VoiceStatus>('idle');

/** Whether the microphone is muted. */
export const voiceMutedAtom = atom<boolean>(false);

/** Whether the user has just interrupted the assistant. */
export const voiceBargeInAtom = atom<boolean>(false);

/** Latest normalised microphone amplitude in 0..1, for the level meter. */
export const voiceMicLevelAtom = atom<number>(0);

/** The running transcript, oldest first. */
export const voiceTranscriptsAtom = atom<VoiceTranscript[]>([]);

/** The last failure message, or `null`. */
export const voiceErrorAtom = atom<string | null>(null);

/** Derived: `true` while a session occupies the transport. */
export const voiceActiveAtom = atom<boolean>((get) => {
  const status = get(voiceStatusAtom);
  return (
    status === 'connecting' || status === 'listening' || status === 'speaking' || status === 'muted'
  );
});

/** Appends one transcript line. */
export const appendVoiceTranscriptAtom = atom(null, (get, set, transcript: VoiceTranscript) => {
  set(voiceTranscriptsAtom, [...get(voiceTranscriptsAtom), transcript]);
});

/** Returns every atom above to its initial value, e.g. when a session ends. */
export const resetVoiceSessionAtom = atom(null, (_get, set) => {
  set(voiceStatusAtom, 'idle');
  set(voiceMutedAtom, false);
  set(voiceBargeInAtom, false);
  set(voiceMicLevelAtom, 0);
  set(voiceTranscriptsAtom, []);
  set(voiceErrorAtom, null);
});
