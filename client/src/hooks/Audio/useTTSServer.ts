import { useCallback, useRef, useState } from 'react';
import { useRecoilValue } from 'recoil';
import { useToastContext } from '@librechat/client';
import type { Dispatch, SetStateAction } from 'react';
import type { PlayingBuffer } from '~/utils/voice/output';
import { getPlaybackContext, playBuffer, primeOutput } from '~/utils/voice/output';
import { chunkForSpeech } from '~/components/Chat/Input/Voice/speech';
import { synthesizeSpeech } from '~/components/Voice/audio';
import { useAuthToken } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';
import store from '~/store';

/**
 * Read-aloud on the Baanzon server voice.
 *
 * Messages are spoken by `/api/voice/tts` (aura for English, the local
 * Kokoro/MMS sidecar for Indic), never by the device engine, so the voice is the
 * same on every phone, browser and OS. Playback goes through the shared Web
 * Audio context, which also survives the iOS ringer switch.
 *
 * The text is chunked by sentence so the first audio starts before the whole
 * message is synthesized and a stop takes effect between chunks.
 */
export default function useTTSServer({
  setIsSpeaking,
}: {
  /** Optional global playback flag (autoplay family) mirrored with local state. */
  setIsSpeaking?: Dispatch<SetStateAction<boolean>>;
} = {}) {
  const token = useAuthToken();
  const playbackRate = useRecoilValue(store.playbackRate);
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [isSpeaking, setSpeakingState] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const playingRef = useRef<PlayingBuffer | null>(null);
  const runRef = useRef(0);

  const setSpeaking = useCallback(
    (value: boolean) => {
      setSpeakingState(value);
      setIsSpeaking?.(value);
    },
    [setIsSpeaking],
  );

  const cancelSpeech = useCallback(() => {
    runRef.current += 1;
    playingRef.current?.stop();
    playingRef.current = null;
    setIsLoading(false);
    setSpeaking(false);
  }, [setSpeaking]);

  const generateSpeech = useCallback(
    async (text: string): Promise<boolean> => {
      const normalized = text.trim();
      if (!normalized) {
        return false;
      }
      cancelSpeech();
      const run = runRef.current;
      // A tap or the send gesture already unlocked the context; autoplay relies
      // on that same unlock.
      primeOutput();
      setIsLoading(true);
      const pieces = chunkForSpeech(normalized);
      const queue = pieces.length > 0 ? pieces : [normalized];
      try {
        for (const piece of queue) {
          if (runRef.current !== run) {
            return false;
          }
          const blob = await synthesizeSpeech(piece, '', token ?? undefined);
          if (runRef.current !== run) {
            return false;
          }
          const context = getPlaybackContext();
          if (!context) {
            throw new Error('audio playback is unavailable');
          }
          const decoded = await context.decodeAudioData(await blob.arrayBuffer());
          if (runRef.current !== run) {
            return false;
          }
          const rate = typeof playbackRate === 'number' && playbackRate > 0 ? playbackRate : 1;
          const playing = playBuffer(decoded, rate);
          if (!playing) {
            throw new Error('audio playback is unavailable');
          }
          playingRef.current = playing;
          setIsLoading(false);
          setSpeaking(true);
          await playing.done;
          if (playingRef.current === playing) {
            playingRef.current = null;
          }
        }
        if (runRef.current === run) {
          setSpeaking(false);
        }
        return true;
      } catch (error) {
        if (runRef.current === run) {
          setIsLoading(false);
          setSpeaking(false);
          showToast({
            message: localize('com_nav_audio_play_error', { 0: (error as Error).message }),
            status: 'error',
          });
        }
        return false;
      }
    },
    [cancelSpeech, localize, playbackRate, setSpeaking, showToast, token],
  );

  const toggleSpeech = useCallback(
    (text: string) => {
      if (isSpeaking || isLoading) {
        cancelSpeech();
        return;
      }
      void generateSpeech(text);
    },
    [cancelSpeech, generateSpeech, isLoading, isSpeaking],
  );

  return { generateSpeech, cancelSpeech, toggleSpeech, isSpeaking, isLoading };
}
