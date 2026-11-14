import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type {
  VoiceHistoryTurn,
  VoiceOptions,
  VoiceStatus,
  VoiceTranscript,
  VoiceTurnFn,
} from '~/components/Voice/types';
import type { SpeechRecognitionEventLike, SpeechRecognitionLike } from '~/utils/voice/speech';
import type { AudioLevelSampler, VoiceActivityDetector } from '~/utils/voice';
import {
  appendVoiceTranscriptAtom,
  resetVoiceSessionAtom,
  upsertVoiceTranscriptAtom,
  voiceBargeInAtom,
  voiceErrorAtom,
  voiceMicLevelAtom,
  voiceMutedAtom,
  voiceStatusAtom,
  voiceTranscriptsAtom,
} from '~/components/Voice/atoms';
import {
  createRecognizer,
  createVoiceActivityDetector,
  createWebAudioVadSampler,
  isDiyaVoiceSupported,
  pickAssistantVoice,
} from '~/utils/voice';
import { VOICE_LABELS } from '~/components/Voice/labels';
import { DiyaTurnError } from '~/components/Voice/api';

/** The session surface returned by {@link useDiyaVoice}. */
export interface UseDiyaVoiceResult {
  status: VoiceStatus;
  /** `true` when a session can run in this environment. */
  supported: boolean;
  muted: boolean;
  /** `true` right after the user barges in on the assistant. */
  bargeIn: boolean;
  /** Latest microphone amplitude in 0..1. */
  micLevel: number;
  transcripts: VoiceTranscript[];
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  /** Starts when idle, stops while active. */
  toggle: () => void;
  setMuted: (muted: boolean) => void;
  /** Cancels the current turn or speech immediately. */
  interrupt: () => void;
}

const DEFAULT_TICK_MS = 100;
const ACTIVE_STATUSES: readonly VoiceStatus[] = [
  'connecting',
  'listening',
  'thinking',
  'speaking',
  'muted',
];
/** How many settled turns are echoed back for context. */
const HISTORY_TURNS = 12;

function isActive(status: VoiceStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/** How microphone capture ended; `unavailable` degrades without VAD, the rest decide the session. */
type CaptureOutcome = 'unavailable' | 'ok' | 'denied' | 'failed';

function turnErrorLabel(caught: unknown): string {
  if (caught instanceof DiyaTurnError) {
    switch (caught.code) {
      case 'unavailable':
        return VOICE_LABELS.turnUnavailable;
      case 'denied':
        return VOICE_LABELS.turnDenied;
      case 'invalid':
        return VOICE_LABELS.turnInvalid;
      default:
        return VOICE_LABELS.turnUpstream;
    }
  }
  return VOICE_LABELS.errorDescription;
}

/**
 * Owns the lifecycle of one Diya Orb session in the browser. Web Speech
 * recognition turns the microphone into text, each finalized utterance goes
 * through the {@link VoiceTurnFn} seam, and the reply is spoken through
 * `speechSynthesis`. The WebAudio capture stays open for the level meter and
 * for barge-in: while the assistant speaks, the user's voice cancels the
 * playback and hands the floor back.
 *
 * Every browser global is optional. Without the speech APIs the hook reports
 * `unsupported`; a denied microphone is the one hard failure and surfaces as
 * `error`. A failed turn keeps the session alive: the label is surfaced and
 * the floor returns to listening.
 */
export function useDiyaVoice(options: VoiceOptions = {}): UseDiyaVoiceResult {
  const {
    turn: injectedTurn,
    vad,
    tickMs = DEFAULT_TICK_MS,
    autoStart = false,
    onTranscript,
  } = options;

  const status = useAtomValue(voiceStatusAtom);
  const muted = useAtomValue(voiceMutedAtom);
  const bargeIn = useAtomValue(voiceBargeInAtom);
  const micLevel = useAtomValue(voiceMicLevelAtom);
  const transcripts = useAtomValue(voiceTranscriptsAtom);
  const error = useAtomValue(voiceErrorAtom);

  const setStatus = useSetAtom(voiceStatusAtom);
  const setMutedAtom = useSetAtom(voiceMutedAtom);
  const setBargeIn = useSetAtom(voiceBargeInAtom);
  const setMicLevel = useSetAtom(voiceMicLevelAtom);
  const setError = useSetAtom(voiceErrorAtom);
  const upsertTranscript = useSetAtom(upsertVoiceTranscriptAtom);
  const appendTranscript = useSetAtom(appendVoiceTranscriptAtom);
  const reset = useSetAtom(resetVoiceSessionAtom);

  const samplerRef = useRef<AudioLevelSampler | null>(null);
  const detectorRef = useRef<VoiceActivityDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const turnControllerRef = useRef<AbortController | null>(null);

  const speakingRef = useRef(false);
  const stoppedRef = useRef(false);
  const mutedRef = useRef(muted);
  const statusRef = useRef<VoiceStatus>(status);
  const supportRef = useRef(false);
  const autoStartRef = useRef(autoStart);
  const onTranscriptRef = useRef(onTranscript);
  const turnRef = useRef<VoiceTurnFn | undefined>(injectedTurn);
  const vadRef = useRef(vad);
  const tickMsRef = useRef(tickMs);
  const transcriptsRef = useRef<VoiceTranscript[]>(transcripts);
  const startRef = useRef<() => Promise<void>>(async () => undefined);

  mutedRef.current = muted;
  statusRef.current = status;
  autoStartRef.current = autoStart;
  onTranscriptRef.current = onTranscript;
  turnRef.current = injectedTurn;
  vadRef.current = vad;
  tickMsRef.current = tickMs;
  transcriptsRef.current = transcripts;

  const supported = useMemo(() => isDiyaVoiceSupported(), []);
  supportRef.current = supported;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Stops the synthesizer and aborts any in-flight turn. */
  const cancelPlayback = useCallback(() => {
    turnControllerRef.current?.abort();
    turnControllerRef.current = null;
    speakingRef.current = false;
    if (typeof speechSynthesis !== 'undefined') {
      try {
        speechSynthesis.cancel();
      } catch {
        /* Already silent. */
      }
    }
  }, []);

  const teardownCapture = useCallback(() => {
    clearTimer();
    samplerRef.current?.dispose();
    samplerRef.current = null;
    detectorRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setMicLevel(0);
  }, [clearTimer, setMicLevel]);

  const teardownRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition == null) {
      return;
    }
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.abort();
    } catch {
      /* Already stopped. */
    }
  }, []);

  const teardown = useCallback(() => {
    stoppedRef.current = true;
    cancelPlayback();
    teardownRecognition();
    teardownCapture();
  }, [cancelPlayback, teardownCapture, teardownRecognition]);

  /** Restarts the recognizer while the floor is the user's and the session is live. */
  const resumeRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition == null || stoppedRef.current || mutedRef.current) {
      return;
    }
    const current = statusRef.current;
    if (current !== 'listening' && current !== 'muted') {
      return;
    }
    try {
      recognition.start();
    } catch {
      /* Already running; `onend` retries. */
    }
  }, []);

  /** Pauses the recognizer for the turn so the microphone does not feed back. */
  const pauseRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition == null || stoppedRef.current) {
      return;
    }
    try {
      recognition.stop();
    } catch {
      /* Already stopped; `onend` fires regardless. */
    }
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (stoppedRef.current || typeof SpeechSynthesisUtterance === 'undefined') {
        return;
      }
      const lang = typeof navigator === 'undefined' ? 'en-US' : navigator.language || 'en-US';
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.voice = pickAssistantVoice(lang) ?? null;
      utterance.onstart = () => {
        if (stoppedRef.current) {
          return;
        }
        speakingRef.current = true;
        if (!mutedRef.current) {
          setStatus('speaking');
        }
      };
      const finish = () => {
        speakingRef.current = false;
        if (stoppedRef.current) {
          return;
        }
        setBargeIn(false);
        if (!mutedRef.current) {
          setStatus('listening');
        }
        resumeRecognition();
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      try {
        speechSynthesis.speak(utterance);
      } catch {
        finish();
      }
    },
    [resumeRecognition, setBargeIn, setStatus],
  );

  const handleTurn = useCallback(
    async (text: string, history: VoiceHistoryTurn[]) => {
      const turnFn = turnRef.current;
      const controller = new AbortController();
      turnControllerRef.current = controller;
      // Mic off while Diya thinks and speaks; the VAD stays on for barge-in.
      pauseRecognition();
      if (!mutedRef.current) {
        setStatus('thinking');
      }
      try {
        const reply = turnFn
          ? await turnFn(text, history, controller.signal)
          : await Promise.reject(new DiyaTurnError('unavailable'));
        if (controller.signal.aborted || stoppedRef.current) {
          return;
        }
        turnControllerRef.current = null;
        const transcript: VoiceTranscript = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: reply,
          final: true,
          at: Date.now(),
        };
        appendTranscript(transcript);
        onTranscriptRef.current?.(transcript);
        setError(null);
        speak(reply);
      } catch (caught) {
        if (controller.signal.aborted || stoppedRef.current) {
          return;
        }
        turnControllerRef.current = null;
        // A failed turn is not fatal: surface it and give the floor back.
        setError(turnErrorLabel(caught));
        if (!mutedRef.current) {
          setStatus('listening');
        }
        resumeRecognition();
      }
    },
    [appendTranscript, pauseRecognition, resumeRecognition, setError, setStatus, speak],
  );

  const handleResults = useCallback(
    (event: SpeechRecognitionEventLike) => {
      if (stoppedRef.current || mutedRef.current) {
        return;
      }
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript?.trim() ?? '';
        if (text === '') {
          continue;
        }
        const id = `t-${index}`;
        if (result.isFinal) {
          // History is snapshotted before this utterance joins the transcript.
          const history = transcriptsRef.current
            .filter((line) => line.final)
            .slice(-HISTORY_TURNS)
            .map((line) => ({ role: line.role, content: line.text }));
          upsertTranscript({
            id,
            role: 'user',
            text,
            final: true,
            at: Date.now(),
          });
          onTranscriptRef.current?.({ id, role: 'user', text, final: true, at: Date.now() });
          void handleTurn(text, history);
        } else {
          upsertTranscript({ id, role: 'user', text, final: false, at: Date.now() });
        }
      }
    },
    [handleTurn, upsertTranscript],
  );

  const startCapture = useCallback(async (): Promise<CaptureOutcome> => {
    const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (mediaDevices == null || typeof mediaDevices.getUserMedia !== 'function') {
      return 'unavailable';
    }
    let stream: MediaStream;
    try {
      stream = await mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (caught) {
      streamRef.current = null;
      const denied =
        caught instanceof Error &&
        (caught.name === 'NotAllowedError' || caught.name === 'SecurityError');
      return denied ? 'denied' : 'failed';
    }
    streamRef.current = stream;
    const handle = createWebAudioVadSampler(stream);
    if (handle == null) {
      return 'ok';
    }
    samplerRef.current = handle.sampler;
    detectorRef.current = createVoiceActivityDetector(vadRef.current);
    timerRef.current = setInterval(() => {
      const sampler = samplerRef.current;
      const detector = detectorRef.current;
      if (sampler == null || detector == null) {
        return;
      }
      if (mutedRef.current) {
        setMicLevel(0);
        return;
      }
      const level = sampler.sample();
      setMicLevel(level);
      const transition = detector.push(level);
      // The user's voice while Diya speaks cancels the playback (barge-in).
      if (transition === 'speech-start' && speakingRef.current) {
        cancelPlayback();
        setBargeIn(true);
        setStatus('listening');
        resumeRecognition();
      } else if (transition === 'speech-end') {
        setBargeIn(false);
      }
    }, tickMsRef.current);
    return 'ok';
  }, [cancelPlayback, resumeRecognition, setBargeIn, setMicLevel, setStatus]);

  const start = useCallback(async () => {
    if (!supportRef.current) {
      setStatus('unsupported');
      return;
    }
    if (isActive(statusRef.current)) {
      return;
    }

    setStatus('connecting');
    setError(null);
    setBargeIn(false);
    stoppedRef.current = false;

    const capture = await startCapture();
    if (capture === 'denied' || capture === 'failed') {
      teardownCapture();
      setError(
        capture === 'denied' ? VOICE_LABELS.micPermissionDenied : VOICE_LABELS.micUnavailable,
      );
      setStatus('error');
      return;
    }

    const lang = typeof navigator === 'undefined' ? 'en-US' : navigator.language || 'en-US';
    const recognition = createRecognizer(lang);
    if (recognition == null) {
      teardownCapture();
      setStatus('unsupported');
      return;
    }
    recognitionRef.current = recognition;
    recognition.onresult = handleResults;
    recognition.onerror = (event) => {
      if (stoppedRef.current) {
        return;
      }
      // `no-speech` and `aborted` are pauses, not failures; `onend` restarts.
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        teardown();
        setError(VOICE_LABELS.micPermissionDenied);
        setStatus('error');
        return;
      }
      if (statusRef.current === 'listening' || statusRef.current === 'muted') {
        setError(VOICE_LABELS.errorDescription);
      }
    };
    recognition.onend = () => {
      if (!stoppedRef.current) {
        resumeRecognition();
      }
    };

    try {
      recognition.start();
      setStatus(mutedRef.current ? 'muted' : 'listening');
    } catch (caught) {
      const message =
        caught instanceof Error && caught.message ? caught.message : VOICE_LABELS.errorDescription;
      teardown();
      setError(message);
      setStatus('error');
    }
  }, [
    handleResults,
    resumeRecognition,
    setBargeIn,
    setError,
    setStatus,
    startCapture,
    teardown,
    teardownCapture,
  ]);
  startRef.current = start;

  const stop = useCallback(() => {
    teardown();
    setBargeIn(false);
    setStatus('idle');
  }, [setStatus, setBargeIn, teardown]);

  const toggle = useCallback(() => {
    if (isActive(statusRef.current)) {
      stop();
    } else {
      void start();
    }
  }, [start, stop]);

  const applyMute = useCallback(
    (next: boolean) => {
      setMutedAtom(next);
      mutedRef.current = next;
      const current = statusRef.current;
      if (next) {
        setMicLevel(0);
        if (current === 'listening' || current === 'speaking' || current === 'thinking') {
          setStatus('muted');
        }
        return;
      }
      if (current === 'muted') {
        setStatus(speakingRef.current ? 'speaking' : 'listening');
      }
    },
    [setMicLevel, setMutedAtom, setStatus],
  );

  const interrupt = useCallback(() => {
    if (!isActive(statusRef.current)) {
      return;
    }
    cancelPlayback();
    setBargeIn(true);
    if (statusRef.current === 'speaking' || statusRef.current === 'thinking') {
      setStatus('listening');
    }
    resumeRecognition();
  }, [cancelPlayback, resumeRecognition, setBargeIn, setStatus]);

  useEffect(() => {
    if (!supported) {
      setStatus('unsupported');
      return;
    }
    if (autoStartRef.current) {
      void startRef.current();
    }
  }, [supported, setStatus]);

  useEffect(() => {
    return () => {
      teardown();
      reset();
    };
  }, [reset, teardown]);

  return {
    status,
    supported,
    muted,
    bargeIn,
    micLevel,
    transcripts,
    error,
    start,
    stop,
    toggle,
    setMuted: applyMute,
    interrupt,
  };
}

export default useDiyaVoice;
