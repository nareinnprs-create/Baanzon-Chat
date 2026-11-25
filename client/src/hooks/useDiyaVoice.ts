import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type {
  VoiceOptions,
  VoiceStatus,
  VoiceTranscript,
  VoiceTurnFn,
} from '~/components/Voice/types';
import type { AudioLevelSampler, VoiceActivityDetector } from '~/utils/voice';
import type { PlayingBuffer } from '~/utils/voice/output';
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
  createVoiceActivityDetector,
  createWebAudioVadSampler,
  isDiyaVoiceSupported,
} from '~/utils/voice';
import {
  getFallbackPlayer,
  getPlaybackContext,
  playBuffer,
  primeOutput,
} from '~/utils/voice/output';
import { isSupportedVoiceLang, synthesizeSpeech, transcribeAudio } from '~/components/Voice/audio';
import { chunkForSpeech as chunkTextForSpeech } from '~/components/Chat/Input/Voice/speech';
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
/** Guard against one endless recording (e.g. a stuck VAD). */
const MAX_UTTERANCE_MS = 45000;
/** A turn that never answers must not leave the orb thinking forever. */
const TURN_TIMEOUT_MS = 45000;
/** Recordings shorter than this are noise, not speech. */
const MIN_UTTERANCE_MS = 250;
/** Rejects clicks and single-sample spikes before a recording starts. */
const MIN_SPEECH_MS = 250;
/** Level that counts as the user talking over Diya. */
const BARGE_IN_LEVEL = 0.7;
/** Sustained ticks needed to interrupt; ~500ms at the 100ms tick. */
const BARGE_IN_TICKS = 5;

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

/** Prefers opus/webm and falls back to whatever the browser supports. */
function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') {
    return undefined;
  }
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

/**
 * Diya Orb session.
 *
 * Audio never touches device speech engines: the microphone is recorded and
 * sent to our Whisper endpoint (auto language), and replies are synthesized by
 * our server (one fixed female voice per language) and played back as audio
 * files. Capture is VAD-segmented and stays alive for the whole session, so
 * there is no restart dead-zone after a reply; the same VAD cancels playback
 * on barge-in and immediately records the interruption.
 */
export function useDiyaVoice(options: VoiceOptions = {}): UseDiyaVoiceResult {
  const {
    turn: injectedTurn,
    vad,
    tickMs = DEFAULT_TICK_MS,
    autoStart = false,
    onTranscript,
    token,
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
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const utteranceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const turnControllerRef = useRef<AbortController | null>(null);

  const speakingRef = useRef(false);
  /** Incremented on every cancel so a stale sentence loop stops. */
  const speakTokenRef = useRef(0);
  /** One element for the whole session: unlocking it once inside the tap keeps
   *  every later play() allowed on iOS and Android PWAs. */
  const playerRef = useRef<HTMLAudioElement | null>(null);
  /** Resolves the sentence currently waiting on playback (cancel path). */
  const releasePlaybackRef = useRef<(() => void) | null>(null);
  /** The Web Audio source currently playing, when that path is in use. */
  const playingRef = useRef<PlayingBuffer | null>(null);
  /** Consecutive loud samples while Diya speaks; her own voice must not count. */
  const bargeStreakRef = useRef(0);
  const stoppedRef = useRef(false);
  const mutedRef = useRef(muted);
  const statusRef = useRef<VoiceStatus>(status);
  const supportRef = useRef(false);
  const autoStartRef = useRef(autoStart);
  const onTranscriptRef = useRef(onTranscript);
  const turnRef = useRef<VoiceTurnFn | undefined>(injectedTurn);
  const vadRef = useRef(vad);
  const tickMsRef = useRef(tickMs);
  const tokenRef = useRef(token);
  const transcriptsRef = useRef<VoiceTranscript[]>(transcripts);
  const startRef = useRef<() => Promise<void>>(async () => undefined);
  /** Language detected by the last transcription; used when the reply text is Latin. */
  const sessionLangRef = useRef('en');

  statusRef.current = status;
  mutedRef.current = muted;
  onTranscriptRef.current = onTranscript;
  turnRef.current = injectedTurn;
  vadRef.current = vad;
  tickMsRef.current = tickMs;
  tokenRef.current = token;
  transcriptsRef.current = transcripts;

  const supported = useMemo(() => isDiyaVoiceSupported(), []);
  supportRef.current = supported;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearUtteranceTimer = useCallback(() => {
    if (utteranceTimerRef.current !== null) {
      clearTimeout(utteranceTimerRef.current);
      utteranceTimerRef.current = null;
    }
  }, []);

  /**
   * Unlocks media output inside the tap gesture: resumes the shared Web Audio
   * context (the path that survives the iOS ringer switch) and unlocks the
   * element fallback. Safe to call more than once.
   */
  const primePlayer = useCallback(() => {
    primeOutput();
    const fallback = getFallbackPlayer();
    if (fallback != null) {
      playerRef.current = fallback;
    }
    return playerRef.current;
  }, []);

  /** Returns the orb to listening; every exit path of a reply goes through it. */
  const finishSpeaking = useCallback(() => {
    speakingRef.current = false;
    releasePlaybackRef.current = null;
    if (!stoppedRef.current && !mutedRef.current) {
      setBargeIn(false);
      setStatus('listening');
    }
  }, [setBargeIn, setStatus]);

  /** Stops audio playback and aborts any in-flight turn. */
  const cancelPlayback = useCallback(() => {
    turnControllerRef.current?.abort();
    turnControllerRef.current = null;
    speakingRef.current = false;
    bargeStreakRef.current = 0;
    // Bumping the token stops a sentence loop that is between chunks, so the
    // rest of the reply cannot play over the user who just interrupted.
    speakTokenRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      } catch {
        /* already released */
      }
      audioRef.current = null;
    }
    // Resolve the awaited playback promise; pause alone no longer does it.
    releasePlaybackRef.current?.();
    releasePlaybackRef.current = null;
    // Web Audio path: stop the source and settle its promise.
    playingRef.current?.stop();
    playingRef.current = null;
  }, []);

  const teardownCapture = useCallback(() => {
    clearTimer();
    clearUtteranceTimer();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    recorderChunksRef.current = [];
    samplerRef.current?.dispose();
    samplerRef.current = null;
    detectorRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setMicLevel(0);
  }, [clearTimer, clearUtteranceTimer, setMicLevel]);

  const teardown = useCallback(() => {
    stoppedRef.current = true;
    cancelPlayback();
    // Keep the element (its unlock survives), just release the source.
    const player = playerRef.current;
    if (player != null) {
      try {
        player.pause();
        player.removeAttribute('src');
      } catch {
        /* already released */
      }
    }
    teardownCapture();
  }, [cancelPlayback, teardownCapture]);

  const handleTurn = useCallback(
    async (text: string) => {
      const turnFn = turnRef.current;
      const controller = new AbortController();
      turnControllerRef.current = controller;
      // A turn that never answers must not leave the orb thinking forever.
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, TURN_TIMEOUT_MS);
      // Mic off while Diya thinks and speaks; the VAD stays on for barge-in.
      stopRecordingRef.current();
      if (!mutedRef.current) {
        setStatus('thinking');
      }
      try {
        const reply = turnFn
          ? await turnFn(
              text,
              transcriptsRef.current
                .filter((line) => line.final)
                .slice(-HISTORY_TURNS)
                .map((line) => ({ role: line.role, content: line.text })),
              controller.signal,
              sessionLangRef.current,
            )
          : await Promise.reject(new DiyaTurnError('unavailable'));
        clearTimeout(timeout);
        if (controller.signal.aborted || stoppedRef.current) {
          if (timedOut) {
            setError(VOICE_LABELS.turnTimeout);
            if (!mutedRef.current) {
              setStatus('listening');
            }
          }
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
        speakRef.current(reply);
      } catch (caught) {
        clearTimeout(timeout);
        if (controller.signal.aborted || stoppedRef.current) {
          if (timedOut && !stoppedRef.current) {
            setError(VOICE_LABELS.turnTimeout);
            if (!mutedRef.current) {
              setStatus('listening');
            }
          }
          return;
        }
        turnControllerRef.current = null;
        // A failed turn is not fatal: surface it and give the floor back.
        setError(turnErrorLabel(caught));
        if (!mutedRef.current) {
          setStatus('listening');
        }
      }
    },
    [appendTranscript, setError, setStatus],
  );

  /** Sends one recorded utterance to the server for transcription, then the turn. */
  const submitRecording = useCallback(
    async (blob: Blob, durationMs: number) => {
      if (stoppedRef.current || mutedRef.current) {
        return;
      }
      if (durationMs < MIN_UTTERANCE_MS || blob.size < 800) {
        return;
      }
      try {
        const { text, language } = await transcribeAudio(blob, tokenRef.current);
        if (!text || stoppedRef.current) {
          return;
        }
        if (language && isSupportedVoiceLang(language)) {
          // A code we cannot speak (Whisper sometimes reports Russian for
          // Indic speech) must not become the session's language.
          sessionLangRef.current = language.slice(0, 2).toLowerCase();
        }
        const transcript: VoiceTranscript = {
          id: `u-${Date.now()}`,
          role: 'user',
          text,
          final: true,
          at: Date.now(),
        };
        upsertTranscript(transcript);
        onTranscriptRef.current?.(transcript);
        void handleTurn(text);
      } catch {
        if (!stoppedRef.current) {
          setError(VOICE_LABELS.errorDescription);
        }
      }
    },
    [handleTurn, setError, upsertTranscript],
  );

  /** Starts a fresh recording segment (no-op while one is running). */
  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || stoppedRef.current || mutedRef.current) {
      return;
    }
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      return;
    }
    try {
      const recorder = new MediaRecorder(stream, { mimeType: pickRecorderMime() });
      recorderChunksRef.current = [];
      recordingStartedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recorderChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const duration = Date.now() - recordingStartedAtRef.current;
        const chunks = recorderChunksRef.current;
        recorderChunksRef.current = [];
        recorderRef.current = null;
        if (chunks.length === 0) {
          return;
        }
        const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
        void submitRecording(blob, duration);
      };
      recorder.start();
      recorderRef.current = recorder;
      clearUtteranceTimer();
      utteranceTimerRef.current = setTimeout(() => {
        stopRecordingRef.current();
      }, MAX_UTTERANCE_MS);
    } catch {
      /* recorder unavailable - the session keeps running without input */
    }
  }, [clearUtteranceTimer, submitRecording]);

  /** Ends the current segment; `onstop` submits it. */
  const stopRecording = useCallback(() => {
    clearUtteranceTimer();
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') {
      return;
    }
    try {
      recorder.stop();
    } catch {
      recorderRef.current = null;
    }
  }, [clearUtteranceTimer]);

  const startRecordingRef = useRef(startRecording);
  const stopRecordingRef = useRef(stopRecording);
  startRecordingRef.current = startRecording;
  stopRecordingRef.current = stopRecording;

  /** Synthesizes and plays the reply sentence-by-sentence in the fixed voice. */
  const speak = useCallback(
    async (text: string) => {
      if (stoppedRef.current || mutedRef.current) {
        return;
      }
      const chunks = chunkTextForSpeech(text);
      const pieces = chunks.length > 0 ? chunks : [text];
      // The server resolves the final voice from the text's script, so the
      // session language is a better hint than a client-side script guess that
      // cannot tell Marathi from Hindi.
      const lang = sessionLangRef.current;
      const token = speakTokenRef.current;
      const cancelled = () =>
        stoppedRef.current || mutedRef.current || speakTokenRef.current !== token;
      const player = primePlayer();
      let failed = false;
      setStatus('speaking');
      for (const piece of pieces) {
        if (cancelled()) {
          finishSpeaking();
          return;
        }
        let blob: Blob;
        try {
          blob = await synthesizeSpeech(piece, lang, tokenRef.current);
        } catch {
          // A dead provider must not be retried sentence by sentence, and it
          // must not look like success: surface it instead of staying silent.
          failed = true;
          break;
        }
        if (cancelled()) {
          finishSpeaking();
          return;
        }
        // Web Audio first: it survives the iOS ringer switch and gives this
        // sentence its own source, so a later reply cannot steal it.
        const ctx = getPlaybackContext();
        if (ctx != null) {
          try {
            const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
            if (cancelled()) {
              finishSpeaking();
              return;
            }
            const playing = playBuffer(decoded);
            if (playing != null) {
              playingRef.current = playing;
              speakingRef.current = true;
              await playing.done;
              if (playingRef.current === playing) {
                playingRef.current = null;
              }
              if (cancelled()) {
                finishSpeaking();
                return;
              }
              continue;
            }
          } catch {
            /* undecodable in this browser - fall through to the element */
          }
        }
        if (cancelled()) {
          finishSpeaking();
          return;
        }
        if (player == null) {
          // No Web Audio and no element: nothing can play this reply.
          failed = true;
          break;
        }
        const url = URL.createObjectURL(blob);
        audioRef.current = player;
        speakingRef.current = true;
        await new Promise<void>((resolve) => {
          const release = () => {
            if (releasePlaybackRef.current === release) {
              releasePlaybackRef.current = null;
            }
            URL.revokeObjectURL(url);
            resolve();
          };
          releasePlaybackRef.current = release;
          player.onended = release;
          player.onerror = release;
          player.muted = false;
          player.src = url;
          void player.play().catch(() => {
            // Autoplay refusal (or a codec problem) is a real failure.
            failed = true;
            release();
          });
        });
        if (audioRef.current === player) {
          audioRef.current = null;
        }
        if (cancelled()) {
          finishSpeaking();
          return;
        }
        if (failed) {
          break;
        }
      }
      if (failed) {
        setError(VOICE_LABELS.speakFailed);
      }
      finishSpeaking();
    },
    [finishSpeaking, primePlayer, setError, setStatus],
  );

  const speakRef = useRef(speak);
  speakRef.current = speak;

  const startCapture = useCallback(async (): Promise<CaptureOutcome> => {
    const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (mediaDevices == null || typeof mediaDevices.getUserMedia !== 'function') {
      return 'unavailable';
    }
    let stream: MediaStream;
    try {
      // Echo cancellation keeps Diya's own voice out of the VAD, so only the
      // user's speech counts as barge-in.
      stream = await mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
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
      // No analyser means no way to know when the user speaks, so the session
      // would sit "listening" forever. Fail loudly instead of pretending.
      return 'failed';
    }
    samplerRef.current = handle.sampler;
    detectorRef.current = createVoiceActivityDetector({
      minSpeechMs: MIN_SPEECH_MS,
      ...vadRef.current,
    });
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

      // While Diya holds the floor, only sustained loud input interrupts. A
      // single 100ms window (speaker bleed of her own voice, a click, a cough)
      // must not cut her off, and no recording starts until she is done.
      if (speakingRef.current || turnControllerRef.current !== null) {
        bargeStreakRef.current = level > BARGE_IN_LEVEL ? bargeStreakRef.current + 1 : 0;
        if (bargeStreakRef.current >= BARGE_IN_TICKS) {
          bargeStreakRef.current = 0;
          cancelPlayback();
          setBargeIn(true);
          setStatus('listening');
          startRecordingRef.current();
        }
        return;
      }

      bargeStreakRef.current = 0;
      if (transition === 'speech-start') {
        startRecordingRef.current();
      } else if (transition === 'speech-end') {
        setBargeIn(false);
        stopRecordingRef.current();
      }
    }, tickMsRef.current);
    return 'ok';
  }, [cancelPlayback, setBargeIn, setMicLevel, setStatus]);

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
    bargeStreakRef.current = 0;
    // Must happen inside the tap, before the first await, or mobile browsers
    // refuse every later play() for this session.
    primePlayer();

    const capture = await startCapture();
    if (capture === 'denied' || capture === 'failed') {
      teardownCapture();
      setError(
        capture === 'denied' ? VOICE_LABELS.micPermissionDenied : VOICE_LABELS.micUnavailable,
      );
      setStatus('error');
      return;
    }
    setStatus(mutedRef.current ? 'muted' : 'listening');
  }, [primePlayer, setBargeIn, setError, setStatus, startCapture, teardownCapture]);

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
        stopRecordingRef.current();
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
    cancelPlayback();
    setBargeIn(true);
    if (statusRef.current === 'speaking' || statusRef.current === 'thinking') {
      setStatus('listening');
    }
    startRecordingRef.current();
  }, [cancelPlayback, setBargeIn, setStatus]);

  useEffect(() => {
    if (!supported) {
      setStatus('unsupported');
      return;
    }
    if (autoStartRef.current) {
      void startRef.current();
    }
  }, [supported, setStatus]);

  // Backgrounding the PWA must release the microphone: Android keeps the mic
  // indicator lit and iOS returns to a dead AudioContext, so the session is
  // ended and the user restarts it with a tap.
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && isActive(statusRef.current)) {
        teardown();
        setBargeIn(false);
        setStatus('idle');
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [setBargeIn, setStatus, teardown]);

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
