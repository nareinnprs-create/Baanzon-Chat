import { useCallback, useEffect, useRef } from 'react';
import { useSetAtom, useAtomValue, useAtom } from 'jotai';
import type { RealtimeClientMessage, RealtimeServerMessage } from '~/components/Voice/types';
import {
  appendVoiceTranscriptAtom,
  resetVoiceSessionAtom,
  upsertVoiceTranscriptAtom,
  voiceBargeInAtom,
  voiceCaptionsAtom,
  voiceErrorAtom,
  voiceMicLevelAtom,
  voiceMutedAtom,
  voiceRemainingSecondsAtom,
  voiceSelectedVoiceAtom,
  voiceStatusAtom,
  voiceVoicesAtom,
} from '~/components/Voice/atoms';
import { createVoiceActivityDetector } from '~/utils/voice/vad';
import { adoptPrimedContexts } from '~/utils/voice/primeAudio';
import { VOICE_LABELS as L } from '~/components/Voice/labels';
import { useAuthToken } from '~/hooks/AuthContext';

/**
 * Realtime voice session over one WebSocket to `/api/voice/realtime`.
 *
 * Mic → 16 kHz linear16 PCM (capture worklet) upstream; 24 kHz linear16 PCM
 * (playback worklet) downstream. Server JSON frames drive the same
 * feature-owned Jotai atoms the Diya panel uses, so both surfaces share one
 * status vocabulary. Barge-in is local: the VAD hears speech while the reply
 * plays and the queue is cleared instantly. The auth token rides the
 * WebSocket subprotocol because there is no `jwt` cookie.
 */

export const CAPTURE_RATE = 16000;
export const PLAYBACK_RATE = 24000;
const CAPTURE_CHUNK = 1600; // 100 ms of samples per upstream frame
/** Ring holds 8 s so a fast server burst never overwrites unsampled audio. */
const PLAYBACK_RING = PLAYBACK_RATE * 8;
const LEVEL_TICK_MS = 100;
const PING_INTERVAL_MS = 20_000;
/** Barge-in needs sustained speech, not a click or a cough. */
const BARGE_IN_MIN_SPEECH_MS = 120;

const CAPTURE_WORKLET = `
class PCMCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.n = 0;
    this.chunk = new Int16Array(${CAPTURE_CHUNK});
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) { return true; }
    for (let i = 0; i < ch.length; i++) {
      let s = Math.round(ch[i] * 32767);
      if (s > 32767) s = 32767; else if (s < -32768) s = -32768;
      this.chunk[this.n++] = s;
      if (this.n === this.chunk.length) {
        this.port.postMessage(this.chunk.slice(0));
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('baanzon-pcm-capture', PCMCapture);
`;

const PLAYBACK_WORKLET = `
class PCMPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = ${PLAYBACK_RING};
    this.q = new Float32Array(this.cap);
    this.r = 0;
    this.w = 0;
    this.len = 0;
    this.playing = false;
    this.port.onmessage = (e) => {
      if (e.data && e.data.clear) {
        this.r = this.w = this.len = 0;
        this.playing = false;
        return;
      }
      const pcm = e.data;
      const overflow = this.len + pcm.length - this.cap;
      if (overflow > 0) {
        this.r = (this.r + overflow) % this.cap;
        this.len -= overflow;
      }
      for (let i = 0; i < pcm.length; i++) {
        this.q[(this.w + i) % this.cap] = pcm[i] / 32768;
      }
      this.w = (this.w + pcm.length) % this.cap;
      this.len += pcm.length;
      this.playing = true;
    };
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    const n = Math.min(out.length, this.len);
    for (let i = 0; i < n; i++) { out[i] = this.q[(this.r + i) % this.cap]; }
    for (let i = n; i < out.length; i++) { out[i] = 0; }
    this.r = (this.r + n) % this.cap;
    this.len -= n;
    if (this.len === 0 && this.playing) {
      this.playing = false;
      this.port.postMessage({ drained: true });
    }
    return true;
  }
}
registerProcessor('baanzon-pcm-player', PCMPlayer);
`;

function workletUrl(code: string): string {
  return URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
}

function realtimeUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/api/voice/realtime`;
}

let transcriptSeq = 0;

export interface VoiceRealtimeHandle {
  end: () => void;
  toggleMuted: () => void;
  setVoice: (id: string) => void;
}

/** Starts the realtime session on mount and tears it down on unmount. */
export function useVoiceRealtime(onEnd: () => void): VoiceRealtimeHandle {
  const token = useAuthToken();
  const [selectedVoice, setSelectedVoice] = useAtom(voiceSelectedVoiceAtom);
  const muted = useAtomValue(voiceMutedAtom);

  const setStatus = useSetAtom(voiceStatusAtom);
  const setMuted = useSetAtom(voiceMutedAtom);
  const setBargeIn = useSetAtom(voiceBargeInAtom);
  const setMicLevel = useSetAtom(voiceMicLevelAtom);
  const setError = useSetAtom(voiceErrorAtom);
  const setVoices = useSetAtom(voiceVoicesAtom);
  const setRemaining = useSetAtom(voiceRemainingSecondsAtom);
  const setCaptions = useSetAtom(voiceCaptionsAtom);
  const appendTranscript = useSetAtom(appendVoiceTranscriptAtom);
  const upsertTranscript = useSetAtom(upsertVoiceTranscriptAtom);
  const reset = useSetAtom(resetVoiceSessionAtom);

  const mutedRef = useRef(false);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const handleEnd = useRef(onEnd);
  handleEnd.current = onEnd;

  // Mutable graph handles; React state only drives what the panel renders.
  const refs = useRef<{
    ws?: WebSocket;
    captureCtx?: AudioContext;
    playbackCtx?: AudioContext;
    playbackNode?: AudioWorkletNode;
    stream?: MediaStream;
    analyser?: AnalyserNode;
    levelBuf?: Float32Array<ArrayBuffer>;
    tick?: number;
    ping?: number;
    vad?: ReturnType<typeof createVoiceActivityDetector>;
    ended: boolean;
    unbound: Array<() => void>;
    /** Reply audio that arrived before the player existed; flushed on mount. */
    pendingAudio: ArrayBuffer[];
  }>({ ended: true, unbound: [], pendingAudio: [] });

  const teardown = useCallback(() => {
    const r = refs.current;
    if (r.ended) {
      return;
    }
    r.ended = true;
    if (r.tick) {
      clearInterval(r.tick);
    }
    if (r.ping) {
      clearInterval(r.ping);
    }
    for (const fn of r.unbound) {
      try {
        fn();
      } catch {
        /* node already gone */
      }
    }
    r.unbound = [];
    try {
      r.ws?.close(1000, 'client end');
    } catch {
      /* socket gone */
    }
    void r.captureCtx?.close().catch(() => undefined);
    void r.playbackCtx?.close().catch(() => undefined);
    r.stream?.getTracks().forEach((t) => t.stop());
  }, []);

  const end = useCallback(() => {
    teardown();
    reset();
    handleEnd.current();
  }, [teardown, reset]);

  const toggleMuted = useCallback(() => {
    if (refs.current.ended) {
      return;
    }
    setMuted((prev) => {
      const next = !prev;
      refs.current.ws?.send(
        JSON.stringify({ type: 'mute', muted: next } satisfies RealtimeClientMessage),
      );
      setStatus(next ? 'muted' : 'listening');
      return next;
    });
  }, [setStatus, setMuted]);

  const setVoice = useCallback((id: string) => setSelectedVoice(id), [setSelectedVoice]);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    const r = refs.current;
    r.ended = false;
    r.unbound = [];
    r.pendingAudio = [];
    reset();
    setStatus('connecting');

    const ws = new WebSocket(realtimeUrl(), [token]);
    ws.binaryType = 'arraybuffer';
    r.ws = ws;

    const send = (message: RealtimeClientMessage) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    };

    ws.onclose = () => {
      if (!cancelled && !r.ended) {
        setError(L.connectionLost);
        setStatus('error');
        teardown();
        handleEnd.current();
      }
    };
    ws.onerror = () => {
      if (!cancelled && !r.ended) {
        setError(L.connectionFailed);
        setStatus('error');
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        let msg: RealtimeServerMessage;
        try {
          msg = JSON.parse(event.data) as RealtimeServerMessage;
        } catch {
          return;
        }
        switch (msg.type) {
          case 'ready': {
            setVoices(msg.voices);
            setRemaining(msg.remainingSeconds);
            setCaptions(msg.captions);
            void startMic();
            send({ type: 'start', voice: selectedVoice ?? undefined });
            return;
          }
          case 'state': {
            if (msg.state === 'listening') {
              setBargeIn(false);
            }
            // The playback drain flips speaking → listening itself; a server
            // 'listening' while audio is still queued is only advisory.
            setStatus((prev) =>
              prev === 'speaking' && msg.state === 'listening' ? prev : msg.state,
            );
            return;
          }
          case 'user-transcript': {
            if (msg.final) {
              appendTranscript({
                id: `u${++transcriptSeq}`,
                role: 'user',
                text: msg.text,
                final: true,
                at: Date.now(),
              });
            } else {
              upsertTranscript({
                id: 'interim',
                role: 'user',
                text: msg.text,
                final: false,
                at: Date.now(),
              });
            }
            return;
          }
          case 'assistant-transcript':
          case 'interrupted': {
            appendTranscript({
              id: `a${++transcriptSeq}`,
              role: 'assistant',
              text: msg.text,
              final: true,
              at: Date.now(),
            });
            // Server-side TTS: the reply audio follows on the binary channel,
            // so there is nothing to voice locally here.
            return;
          }
          case 'tts-mode': {
            // Informational only: the server now synthesizes every language.
            return;
          }
          case 'error': {
            setError(msg.message || L.errorHint);
            setStatus('error');
            if (msg.code === 'cap' || msg.code === 'auth') {
              teardown();
              handleEnd.current();
            }
            return;
          }
          default:
            return;
        }
      }
      // Binary: reply audio. The player drains it and reports when done.
      const node = refs.current.playbackNode;
      if (node) {
        node.port.postMessage(new Int16Array(event.data as ArrayBuffer));
      } else {
        // Player not mounted yet (slow worklet load): hold recent audio
        // instead of dropping the reply. Same budget as the player ring.
        const pending = refs.current.pendingAudio;
        pending.push(event.data as ArrayBuffer);
        let bytes = pending.reduce((sum, b) => sum + b.byteLength, 0);
        while (bytes > PLAYBACK_RING * 2 && pending.length > 0) {
          bytes -= pending.shift()?.byteLength ?? 0;
        }
      }
    };

    r.ping = window.setInterval(() => send({ type: 'ping' }), PING_INTERVAL_MS);

    async function startMic() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (cancelled || r.ended) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        r.stream = stream;
        // Contexts were primed inside the mic tap where possible; creating
        // them here (after getUserMedia) would be outside the gesture, which
        // leaves them suspended and the reply silent on mobile.
        const pair = adoptPrimedContexts(CAPTURE_RATE, PLAYBACK_RATE);
        const ctx = pair.capture;
        r.captureCtx = ctx;
        await ctx.audioWorklet.addModule(workletUrl(CAPTURE_WORKLET));
        const node = new AudioWorkletNode(ctx, 'baanzon-pcm-capture');
        node.port.onmessage = (e: MessageEvent) => {
          if (!refs.current.ended && !mutedRef.current) {
            ws.send(e.data as ArrayBuffer);
          }
        };
        const source = ctx.createMediaStreamSource(stream);
        source.connect(node); // never to destination: no local echo
        r.unbound.push(() => {
          node.port.onmessage = null;
          node.disconnect();
          source.disconnect();
        });

        // Reply playback graph: 24 kHz linear16 with a ring buffer.
        const pctx = pair.playback;
        r.playbackCtx = pctx;
        await pctx.audioWorklet.addModule(workletUrl(PLAYBACK_WORKLET));
        const pnode = new AudioWorkletNode(pctx, 'baanzon-pcm-player');
        pnode.connect(pctx.destination);
        pnode.port.onmessage = (e: MessageEvent) => {
          // Queue drained: hand control back to the user.
          if (e.data?.drained) {
            setStatus((prev) => (prev === 'speaking' ? 'listening' : prev));
            setBargeIn(false);
          }
        };
        r.playbackNode = pnode;
        r.unbound.push(() => {
          pnode.port.onmessage = null;
          pnode.disconnect();
        });
        // Audio that arrived before the player existed is flushed now.
        for (const buffer of r.pendingAudio.splice(0)) {
          pnode.port.postMessage(new Int16Array(buffer));
        }

        // Priming can be absent (overlay opened outside a tap): any context
        // still suspended resumes on the first tap anywhere in the document —
        // resume() must run inside the gesture itself.
        if (ctx.state !== 'running' || pctx.state !== 'running') {
          const resumeAll = () => {
            void refs.current.captureCtx?.resume().catch(() => undefined);
            void refs.current.playbackCtx?.resume().catch(() => undefined);
          };
          document.addEventListener('pointerdown', resumeAll, { once: true });
          r.unbound.push(() => document.removeEventListener('pointerdown', resumeAll));
        }

        // Level meter + barge-in VAD run off the same capture context.
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        r.analyser = analyser;
        r.levelBuf = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>;
        r.vad = createVoiceActivityDetector({ minSpeechMs: BARGE_IN_MIN_SPEECH_MS });

        setStatus('listening');

        r.tick = window.setInterval(() => {
          const a = refs.current.analyser;
          const buf = refs.current.levelBuf;
          if (!a || !buf) {
            return;
          }
          a.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            sum += buf[i] * buf[i];
          }
          const level = Math.sqrt(sum / buf.length);
          setMicLevel(Math.min(1, level * 4));
          // Barge-in: only while the reply is playing.
          setStatus((prev) => {
            if (prev === 'speaking') {
              const event = refs.current.vad?.push(level);
              if (event === 'speech-start') {
                send({ type: 'barge-in' });
                refs.current.playbackNode?.port.postMessage({ clear: true });
                setBargeIn(true);
              }
            }
            return prev;
          });
        }, LEVEL_TICK_MS);
      } catch (err) {
        const name = (err as DOMException)?.name;
        setError(name === 'NotAllowedError' ? L.micPermissionDenied : L.micUnavailable);
        setStatus('error');
        teardown();
        handleEnd.current();
      }
    }

    return () => {
      cancelled = true;
      teardown();
    };
    // One session per mount: the socket and mic graph are established once and
    // `selectedVoice` binds at `ready` by design (the server binds it there).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return { end, toggleMuted, setVoice };
}
