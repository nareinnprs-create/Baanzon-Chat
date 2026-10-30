import { useCallback, useEffect, useRef } from 'react';

/**
 * Minimal structural types for the Web Speech recognition API. The DOM lib
 * does not declare `webkitSpeechRecognition`, and declaring the globals here
 * would risk colliding with whichever lib version provides them, so the
 * constructors are read off `window` through this narrow view instead.
 */
type RecognitionAlternative = { transcript: string };
type RecognitionResult = { isFinal: boolean; length: number; 0: RecognitionAlternative };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type RecognitionCtor = new () => RecognitionLike;

const getRecognitionCtor = (): RecognitionCtor | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const isSpeechRecognitionSupported = (): boolean => getRecognitionCtor() != null;

/**
 * Web Speech dictation. Each recognition event reports the finalized text so
 * far plus the current interim string; the caller owns where it lands in the
 * composer (the component rewrites its insertion slot on every event). The
 * engine ends itself on silence, so the hook restarts it until stopped —
 * one click starts, the next click stops.
 */
export default function useSpeechRecognition(onResult: (final: string, interim: string) => void) {
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  const recognitionRef = useRef<RecognitionLike | null>(null);
  const listeningRef = useRef(false);
  const intentionalStopRef = useRef(false);
  const finalizedRef = useRef('');

  const buildRecognition = useCallback((): RecognitionLike | null => {
    const Ctor = getRecognitionCtor();
    if (Ctor == null) {
      return null;
    }
    const recognition = new Ctor();
    recognition.lang = document.documentElement?.lang || navigator.language || 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) {
          finalizedRef.current = finalizedRef.current
            ? `${finalizedRef.current} ${transcript.trim()}`
            : transcript.trim();
        }
      }
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal) {
          interim += result[0]?.transcript ?? '';
        }
      }
      resultRef.current(finalizedRef.current, interim.trim());
    };
    recognition.onend = () => {
      if (intentionalStopRef.current || !listeningRef.current) {
        return;
      }
      // Chrome ends the session after a pause; restart so a click is the only stop control.
      try {
        recognition.start();
      } catch {
        /* already started — the next onresult cycle continues */
      }
    };
    return recognition;
  }, []);

  const start = useCallback(() => {
    if (listeningRef.current || recognitionRef.current != null) {
      return;
    }
    const recognition = buildRecognition();
    if (recognition == null) {
      return;
    }
    recognitionRef.current = recognition;
    listeningRef.current = true;
    intentionalStopRef.current = false;
    finalizedRef.current = '';
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      listeningRef.current = false;
    }
  }, [buildRecognition]);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition == null) {
      return;
    }
    intentionalStopRef.current = true;
    listeningRef.current = false;
    // stop() flushes any pending final result; abort() would drop it.
    try {
      recognition.stop();
    } catch {
      /* engine already ended */
    }
    recognitionRef.current = null;
  }, []);

  // Release the engine on unmount; abort drops pending results, which is
  // right here because a torn-down control owns no composer slot anymore.
  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      if (recognition == null) {
        return;
      }
      listeningRef.current = false;
      intentionalStopRef.current = true;
      try {
        recognition.abort();
      } catch {
        /* engine already ended */
      }
      recognitionRef.current = null;
    };
  }, []);

  return { start, stop };
}
