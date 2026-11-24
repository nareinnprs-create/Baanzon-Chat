import { useCallback, useEffect, useRef, useState } from 'react';
import { transcribeAudio } from '~/components/Voice/audio';

/**
 * Dictation recording for the composer.
 *
 * Records with MediaRecorder and transcribes on our server (Whisper), the same
 * path Diya uses. The previous Web Speech implementation only existed in
 * Chromium: Firefox has no engine, iOS standalone PWAs refuse it, and it could
 * only hear the device locale. This works wherever capture does, auto-detects
 * the language, and reports failures instead of going silent.
 */
export type ScribeState = 'idle' | 'recording' | 'transcribing';

/** Recordings shorter than this are taps, not speech. */
const MIN_MS = 350;
const MIN_BYTES = 1200;
/** One dictation cannot run forever. */
const MAX_MS = 60000;

export function isScribeSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

function pickMime(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const candidate of candidates) {
    if (
      typeof MediaRecorder.isTypeSupported === 'function' &&
      MediaRecorder.isTypeSupported(candidate)
    ) {
      return candidate;
    }
  }
  return undefined;
}

export interface ScribeOptions {
  token?: string | null;
  onText: (text: string) => void;
  /** Receives an i18n key so the caller localizes it. */
  onError: (
    key:
      | 'com_ui_voice_mic_permission_denied'
      | 'com_ui_voice_mic_unavailable'
      | 'com_ui_voice_no_speech'
      | 'com_ui_voice_transcription_failed',
  ) => void;
}

export default function useScribeRecording({ token, onText, onError }: ScribeOptions) {
  const [state, setState] = useState<ScribeState>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const textRef = useRef(onText);
  const errorRef = useRef(onError);
  const tokenRef = useRef(token);
  textRef.current = onText;
  errorRef.current = onError;
  tokenRef.current = token;

  const clearMax = () => {
    if (maxTimerRef.current !== null) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  };

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const finish = useCallback(async () => {
    const chunks = chunksRef.current;
    const duration = Date.now() - startedAtRef.current;
    chunksRef.current = [];
    releaseStream();
    if (cancelledRef.current) {
      setState('idle');
      return;
    }
    if (chunks.length === 0 || duration < MIN_MS) {
      setState('idle');
      return;
    }
    const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
    if (blob.size < MIN_BYTES) {
      setState('idle');
      return;
    }
    setState('transcribing');
    try {
      const { text } = await transcribeAudio(blob, tokenRef.current);
      if (!text) {
        errorRef.current('com_ui_voice_no_speech');
      } else if (!cancelledRef.current) {
        textRef.current(text);
      }
    } catch {
      errorRef.current('com_ui_voice_transcription_failed');
    } finally {
      setState('idle');
    }
  }, [releaseStream]);

  const stop = useCallback(() => {
    clearMax();
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') {
      return;
    }
    try {
      recorder.stop();
    } catch {
      recorderRef.current = null;
      setState('idle');
    }
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current != null || state !== 'idle') {
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
    } catch {
      errorRef.current('com_ui_voice_mic_permission_denied');
      return;
    }
    streamRef.current = stream;
    cancelledRef.current = false;
    chunksRef.current = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: pickMime() });
    } catch {
      releaseStream();
      errorRef.current('com_ui_voice_mic_unavailable');
      return;
    }
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      recorderRef.current = null;
      void finish();
    };
    try {
      recorder.start();
    } catch {
      releaseStream();
      errorRef.current('com_ui_voice_mic_unavailable');
      return;
    }
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setState('recording');
    clearMax();
    maxTimerRef.current = setTimeout(stop, MAX_MS);
  }, [finish, releaseStream, state, stop]);

  const toggle = useCallback(() => {
    if (state === 'recording') {
      stop();
      return;
    }
    if (state === 'idle') {
      void start();
    }
  }, [start, state, stop]);

  /** Drops the take without transcribing (submit, conversation switch, close). */
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    clearMax();
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') {
      try {
        recorder.stop();
      } catch {
        recorderRef.current = null;
      }
    }
    releaseStream();
    chunksRef.current = [];
    setState('idle');
  }, [releaseStream]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      clearMax();
      const recorder = recorderRef.current;
      if (recorder && recorder.state === 'recording') {
        try {
          recorder.stop();
        } catch {
          /* already stopped */
        }
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  return { state, supported: isScribeSupported(), toggle, cancel };
}
