import { atom } from 'jotai';

/**
 * Feature-owned Jotai slice shared by the dictation mic and the read-aloud
 * control so they never talk over each other: starting one stops the other,
 * since most microphones pick up the loudspeaker output. Lives here instead
 * of `~/store` because only this feature reads and writes it.
 */
export type VoiceActivity = 'idle' | 'listening' | 'speaking';

export const voiceActivityAtom = atom<VoiceActivity>('idle');
