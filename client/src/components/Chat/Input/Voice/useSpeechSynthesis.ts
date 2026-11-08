import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { subscribeSpeechVoices, getSpeechVoicesSnapshot } from '~/utils';
import { chunkForSpeech, pickVoiceForLanguage } from './speech';

/**
 * Web Speech synthesis wrapper for read-aloud: picks the first voice matching
 * the document language, queues long text as sentence chunks (utterances past
 * a few hundred characters are silently dropped on some engines), and cancels
 * on stop/unmount so nothing keeps talking after the control is gone.
 */
export default function useSpeechSynthesis(onEnd: (speaking: boolean) => void) {
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  const { voices, supported } = useSyncExternalStore(
    subscribeSpeechVoices,
    getSpeechVoicesSnapshot,
    getSpeechVoicesSnapshot,
  );
  const voicesRef = useRef(voices);
  voicesRef.current = voices;

  const cancel = useCallback(() => {
    if (typeof window === 'undefined' || window.speechSynthesis == null) {
      return;
    }
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* engine already idle */
    }
    endRef.current(false);
  }, []);

  const speak = useCallback(
    (text: string): boolean => {
      const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis;
      if (synth == null) {
        return false;
      }
      const chunks = chunkForSpeech(text);
      if (chunks.length === 0) {
        return false;
      }
      try {
        synth.cancel();
        const voice = pickVoiceForLanguage(
          voicesRef.current,
          document.documentElement?.lang || navigator.language || 'en-US',
        );
        chunks.forEach((chunk, i) => {
          const utterance = new SpeechSynthesisUtterance(chunk);
          if (voice) {
            utterance.voice = voice;
          }
          if (i === chunks.length - 1) {
            // Only the last chunk reports the end; earlier onends would flip
            // the toggle mid-queue.
            utterance.onend = () => endRef.current(false);
            utterance.onerror = () => endRef.current(false);
          }
          synth.speak(utterance);
        });
        endRef.current(true);
        return true;
      } catch {
        endRef.current(false);
        return false;
      }
    },
    [],
  );

  useEffect(() => cancel, [cancel]);

  return { speak, cancel, supported };
}
