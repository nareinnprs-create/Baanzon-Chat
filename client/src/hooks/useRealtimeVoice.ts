import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type {
  VoiceOptions,
  VoiceStatus,
  VoiceTransport,
  VoiceTranscript,
  VoiceTransportEvent,
} from '~/components/Voice/types';
import type { AudioLevelSampler, VoiceActivityDetector } from '~/utils/voice';
import {
  appendVoiceTranscriptAtom,
  resetVoiceSessionAtom,
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
  createWebRtcTransport,
  isRealtimeVoiceSupported,
} from '~/utils/voice';
import { VOICE_LABELS } from '~/components/Voice/labels';

/** The session surface returned by {@link useRealtimeVoice}. */
export interface UseRealtimeVoiceResult {
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
  /** Signals barge-in immediately, e.g. from a button. */
  interrupt: () => void;
}

const DEFAULT_TICK_MS = 100;
const ACTIVE_STATUSES: readonly VoiceStatus[] = ['connecting', 'listening', 'speaking', 'muted'];

/** How microphone capture ended; `unavailable` is a supported degrade, the rest decide the session. */
type CaptureOutcome = 'unavailable' | 'ok' | 'denied' | 'failed';

function isActive(status: VoiceStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/**
 * Owns the lifecycle of one realtime-voice session over an injected
 * {@link VoiceTransport}. It negotiates the transport, captures the
 * microphone for VAD and the level meter, forwards transcript and
 * assistant-speaking events into Jotai, and drives barge-in when the user
 * speaks over the assistant.
 *
 * Every browser global is optional: without `navigator.mediaDevices`/`AudioContext`
 * the session still runs through the transport, just without local VAD, and
 * without a usable transport the hook reports `unsupported` instead of throwing.
 * A denied or failed microphone request is the one hard failure: it tears the
 * session down and surfaces the error so the user can retry.
 */
export function useRealtimeVoice(options: VoiceOptions = {}): UseRealtimeVoiceResult {
  const {
    transport: injectedTransport = null,
    createTransport,
    rtcConfig,
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
  const appendTranscript = useSetAtom(appendVoiceTranscriptAtom);
  const reset = useSetAtom(resetVoiceSessionAtom);

  const transportRef = useRef<VoiceTransport | null>(null);
  const samplerRef = useRef<AudioLevelSampler | null>(null);
  const detectorRef = useRef<VoiceActivityDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const speakingRef = useRef(false);
  const mutedRef = useRef(muted);
  const statusRef = useRef<VoiceStatus>(status);
  const supportRef = useRef(false);
  const autoStartRef = useRef(autoStart);
  const onTranscriptRef = useRef(onTranscript);
  const vadRef = useRef(vad);
  const tickMsRef = useRef(tickMs);
  const injectedTransportRef = useRef(injectedTransport);
  const createTransportRef = useRef(createTransport);
  const startRef = useRef<() => Promise<void>>(async () => undefined);

  mutedRef.current = muted;
  statusRef.current = status;
  autoStartRef.current = autoStart;
  onTranscriptRef.current = onTranscript;
  vadRef.current = vad;
  tickMsRef.current = tickMs;
  injectedTransportRef.current = injectedTransport;
  createTransportRef.current = createTransport;

  const supported = useMemo(
    () => injectedTransport != null || isRealtimeVoiceSupported(),
    [injectedTransport],
  );
  supportRef.current = supported;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopRemoteAudio = useCallback(() => {
    const audio = remoteAudioRef.current;
    if (audio == null) {
      return;
    }
    try {
      audio.pause();
      audio.srcObject = null;
    } catch {
      /* Detached element already gone. */
    }
    remoteAudioRef.current = null;
  }, []);

  const teardownCapture = useCallback(() => {
    clearTimer();
    samplerRef.current?.dispose();
    samplerRef.current = null;
    detectorRef.current = null;
    transportRef.current?.setMicrophoneStream(null);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setMicLevel(0);
  }, [clearTimer, setMicLevel]);

  const teardownTransport = useCallback(() => {
    unsubsRef.current.forEach((unsubscribe) => unsubscribe());
    unsubsRef.current = [];
    transportRef.current?.close();
    transportRef.current = null;
    speakingRef.current = false;
  }, []);

  const handleRemoteTrack = useCallback((track: MediaStreamTrack) => {
    if (typeof document === 'undefined' || typeof MediaStream === 'undefined') {
      return;
    }
    try {
      const audio = remoteAudioRef.current ?? document.createElement('audio');
      audio.autoplay = true;
      audio.srcObject = new MediaStream([track]);
      remoteAudioRef.current = audio;
      const playback = audio.play();
      if (playback != null && typeof playback.catch === 'function') {
        playback.catch(() => undefined);
      }
    } catch {
      /* Playback is best-effort; the transcript still renders. */
    }
  }, []);

  const handleTransportEvent = useCallback(
    (event: VoiceTransportEvent) => {
      if (event.type === 'assistant-speaking') {
        speakingRef.current = event.speaking;
        setBargeIn(false);
        if (event.speaking) {
          if (!mutedRef.current) {
            setStatus('speaking');
          }
        } else if (statusRef.current === 'speaking') {
          setStatus(mutedRef.current ? 'muted' : 'listening');
        }
        return;
      }
      if (event.type === 'transcript') {
        appendTranscript(event.transcript);
        onTranscriptRef.current?.(event.transcript);
        return;
      }
      if (event.type === 'error') {
        teardownCapture();
        teardownTransport();
        stopRemoteAudio();
        setError(event.message);
        setStatus('error');
        return;
      }
      if (event.type === 'close' && isActive(statusRef.current)) {
        teardownCapture();
        teardownTransport();
        stopRemoteAudio();
        setBargeIn(false);
        setStatus('idle');
      }
    },
    [
      appendTranscript,
      setBargeIn,
      setError,
      setStatus,
      stopRemoteAudio,
      teardownCapture,
      teardownTransport,
    ],
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
    transportRef.current?.setMicrophoneStream(stream);
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
      if (transition === 'speech-start' && speakingRef.current) {
        transportRef.current?.bargeIn();
        setBargeIn(true);
      } else if (transition === 'speech-end') {
        setBargeIn(false);
      }
    }, tickMsRef.current);
    return 'ok';
  }, [setBargeIn, setMicLevel]);

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

    let transport = transportRef.current;
    if (transport == null) {
      const factory =
        createTransportRef.current ??
        ((config?: RTCConfiguration) => createWebRtcTransport({ rtcConfig: config }));
      transport = injectedTransportRef.current ?? factory(rtcConfig);
      if (transport == null) {
        setStatus('unsupported');
        return;
      }
      transportRef.current = transport;
    }

    unsubsRef.current.push(transport.onTrack(handleRemoteTrack));
    unsubsRef.current.push(transport.onEvent(handleTransportEvent));

    const capture = await startCapture();
    if (capture === 'denied' || capture === 'failed') {
      teardownCapture();
      teardownTransport();
      stopRemoteAudio();
      setError(
        capture === 'denied' ? VOICE_LABELS.micPermissionDenied : VOICE_LABELS.micUnavailable,
      );
      setStatus('error');
      return;
    }

    try {
      await transport.connect();
      setStatus(mutedRef.current ? 'muted' : 'listening');
    } catch (caught) {
      const message =
        caught instanceof Error && caught.message ? caught.message : VOICE_LABELS.errorDescription;
      teardownCapture();
      teardownTransport();
      stopRemoteAudio();
      setError(message);
      setStatus('error');
    }
  }, [
    handleRemoteTrack,
    handleTransportEvent,
    rtcConfig,
    setBargeIn,
    setError,
    setStatus,
    startCapture,
    stopRemoteAudio,
    teardownCapture,
    teardownTransport,
  ]);
  startRef.current = start;

  const stop = useCallback(() => {
    teardownCapture();
    teardownTransport();
    stopRemoteAudio();
    setBargeIn(false);
    setStatus('idle');
  }, [setBargeIn, setStatus, stopRemoteAudio, teardownCapture, teardownTransport]);

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
        if (current === 'listening' || current === 'speaking') {
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
    transportRef.current?.bargeIn();
    setBargeIn(true);
  }, [setBargeIn]);

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
      teardownCapture();
      teardownTransport();
      stopRemoteAudio();
      reset();
    };
  }, [reset, stopRemoteAudio, teardownCapture, teardownTransport]);

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

export default useRealtimeVoice;
