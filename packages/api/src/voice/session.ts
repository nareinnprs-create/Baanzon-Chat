import type WebSocketType from 'ws';
import {
  CLIENT_SAMPLE_RATE,
  type ServerVoiceMessage,
  type VoiceCatalogEntry,
  type VoiceConfig,
  type VoiceMode,
  type VoiceTurn,
  type VoiceTier,
} from './types';
import { streamChat, type VoiceChatMessage } from './providers/llmOpraiz';
import { openFluxStt, type FluxStt } from './providers/sttFlux';
import { openAuraTts, type AuraTts } from './providers/ttsAura';
import { createSentenceSplitter } from './providers/sentences';
import { normalizeTier, remainingSeconds } from './caps';

/**
 * Voice turn orchestrator: one pod-side state machine per connected client.
 * Mic audio in → flux STT → Opraiz LLM (streaming) → sentence splitter →
 * aura TTS → playback audio out. Everything a test or a v2 GPU swap needs
 * arrives through `deps`; nothing here imports app singletons.
 */

/** Minimal surface of the `ws` socket the session touches. */
export interface VoiceSocket {
  on(event: 'message', cb: (data: WebSocketType.RawData, isBinary: boolean) => void): void;
  on(event: 'close', cb: () => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  send(data: string | Buffer): void;
  ping(): void;
  close(code?: number, reason?: string): void;
}

export interface VoiceGatewayDeps {
  config: VoiceConfig;
  cf: { accountId: string; token: string };
  llm: { baseUrl: string; apiKey: string };
  /** JWT verify → userId, or null when the token is invalid. */
  verifyToken: (token: string) => Promise<string | null>;
  /** The user's subscription tier, mirroring the images-generate lookup. */
  tierOf: (userId: string) => Promise<string | null>;
  /** Seconds already consumed today for the user's tier. */
  usedSeconds: (userId: string, tier: VoiceTier) => Promise<number>;
  /** Add seconds to the user's daily counter (fire-and-forget friendly). */
  addSeconds: (userId: string, tier: VoiceTier, seconds: number) => void;
  store: {
    /** Thread snapshot: last turns (chronological) + chain anchor. */
    loadContext(
      userId: string,
      conversationId?: string,
    ): Promise<{
      conversationId: string;
      turns: VoiceTurn[];
      instructions?: string;
      parentMessageId?: string | null;
    } | null>;
    /** Persist one turn; returns the saved message id. */
    saveTurn(input: {
      userId: string;
      conversationId: string;
      parentMessageId?: string | null;
      role: 'user' | 'assistant';
      text: string;
    }): Promise<string | null>;
  };
  /** Test seams. */
  createStt?: typeof openFluxStt;
  createTts?: typeof openAuraTts;
  chat?: typeof streamChat;
  now?: () => number;
  log?: (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;
}

const METER_INTERVAL_SECONDS = 30;
/** CF edge idles WebSockets ~100s; pings keep both directions warm. */
const PING_INTERVAL_MS = 25_000;
/** Muted keepalive: 1s of silence at 16kHz linear16. */
const SILENCE_FRAME = Buffer.alloc(CLIENT_SAMPLE_RATE * 2, 0);

export interface VoiceGateway {
  handleConnection(ws: VoiceSocket, auth: { token?: string; cid?: string }): Promise<void>;
}

export function createVoiceGateway(deps: VoiceGatewayDeps): VoiceGateway {
  const createStt = deps.createStt ?? openFluxStt;
  const createTts = deps.createTts ?? openAuraTts;
  const chat = deps.chat ?? streamChat;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  // One voice session per user: the map holds each session's closer so a
  // fresh connection can replace a stale one.
  const sessions = new Map<string, () => void>();

  return { handleConnection };

  async function handleConnection(ws: VoiceSocket, auth: { token?: string; cid?: string }) {
    let closed = false;
    const userId = auth.token ? await deps.verifyToken(auth.token) : null;
    if (!userId) {
      send(ws, { type: 'error', code: 'auth', message: 'Authentication required' });
      ws.close(1008, 'unauthorized');
      return;
    }
    // Alias keeps TS's non-null narrowing alive inside the nested closures.
    const uid: string = userId;

    let voice: VoiceCatalogEntry | undefined;
    let mode: VoiceMode = deps.config.defaultMode;
    // Boxed so closures can read/write it without TS narrowing fights.
    type TurnState = 'listening' | 'thinking' | 'speaking';
    // Reads go through a function so TS can't narrow the box across closures.
    const box: { value: TurnState } = { value: 'listening' };
    const state = (): TurnState => box.value;
    let muted = false;
    let currentUserText = '';

    let stt: FluxStt | null = null;
    let tts: AuraTts | null = null;
    let abort: AbortController | null = null;
    let spokenSentences = '';
    let meterAnchor = now();
    /** Set by `interrupt`, checked after the aborted stream resolves. */
    let turnInterrupted = false;

    const previous = sessions.get(uid);
    if (previous) {
      previous();
    }

    const tier = normalizeTier(await deps.tierOf(uid));
    const remaining = remainingSeconds(tier, await deps.usedSeconds(uid, tier), deps.config.tierMinutes);
    if (remaining <= 0) {
      send(ws, { type: 'error', code: 'cap', message: "You're out of voice time for today" });
      ws.close(1000, 'cap');
      return;
    }

    const loaded = await deps.store.loadContext(uid, auth.cid);
    if (!loaded) {
      send(ws, { type: 'error', code: 'server', message: 'Could not start the voice session' });
      ws.close(1011, 'no-context');
      return;
    }
    const ctx = loaded;

    const session = { close };
    sessions.set(uid, () => session.close());

    // .unref(): the pod's lifetime belongs to the HTTP server, not these.
    const meter = setInterval(() => {
      if (closed) {
        return;
      }
      deps.addSeconds(uid, tier, METER_INTERVAL_SECONDS);
      meterAnchor = now();
      void (async () => {
        const left = remainingSeconds(tier, await deps.usedSeconds(uid, tier), deps.config.tierMinutes);
        if (left <= 0) {
          send(ws, { type: 'error', code: 'cap', message: "You're out of voice time for today" });
          close();
        }
      })();
    }, METER_INTERVAL_SECONDS * 1000);
    meter.unref();

    const ping = setInterval(() => {
      if (!closed) {
        ws.ping();
      }
    }, PING_INTERVAL_MS);
    ping.unref();

    const silence = setInterval(() => {
      // Muted keepalive: flux sees motion, the CF edge stays warm.
      if (!closed && muted && stt?.usable) {
        stt.sendAudio(SILENCE_FRAME);
      }
    }, 1000);
    silence.unref();

    ws.on('close', () => close('client closed'));
    ws.on('error', (err) => {
      log('warn', 'voice ws error', { userId: uid, error: err.message });
      close('socket error');
    });
    ws.on('message', (data, isBinary) => {
      if (closed) {
        return;
      }
      if (isBinary) {
        onAudio(data as Buffer);
        return;
      }
      onControl(String(data));
    });

    // Providers open lazily; `ready` lands first so the client can show UI.
    send(ws, {
      type: 'ready',
      voices: deps.config.voices,
      mode,
      captions: deps.config.captionsDefault,
      remainingSeconds: remaining,
    });
    send(ws, { type: 'state', state: 'listening' });

    function onControl(raw: string) {
      let msg: { type?: string; [key: string]: unknown };
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'start': {
          if (typeof msg.voice === 'string') {
            voice = deps.config.voices.find((v) => v.id === msg.voice);
          }
          if (msg.muted === true) {
            muted = true;
          }
          stt = openStt();
          tts = openTts(voice?.id);
          break;
        }
        case 'mute':
          muted = msg.muted === true;
          break;
        case 'barge-in':
          interrupt();
          break;
        case 'stop':
          close('client stop');
          break;
        case 'ping':
          send(ws, { type: 'pong' });
          break;
        default:
          break;
      }
    }

    function onAudio(chunk: Buffer) {
      if (muted || state() !== 'listening') {
        return;
      }
      if (!stt?.usable) {
        stt = openStt();
      }
      stt.sendAudio(chunk);
    }

    function openStt(): FluxStt {
      return createStt({
        accountId: deps.cf.accountId,
        token: deps.cf.token,
        sampleRate: CLIENT_SAMPLE_RATE,
        eotThreshold: deps.config.eotThreshold,
        eotTimeoutMs: deps.config.eotTimeoutMs,
        onEvent: (event) => {
          if (closed) {
            return;
          }
          if (event.kind === 'error') {
            log('warn', 'voice stt error', { userId: uid, error: event.message });
            return;
          }
          if (event.kind === 'interim' && event.text) {
            send(ws, { type: 'user-transcript', text: event.text, final: false });
            return;
          }
          if (
            event.kind === 'end-of-turn' &&
            state() === 'listening' &&
            event.text.trim()
          ) {
            void beginTurn(event.text.trim());
          }
        },
      });
    }

    function openTts(speaker?: string): AuraTts {
      return createTts({
        accountId: deps.cf.accountId,
        token: deps.cf.token,
        speaker,
        onAudio: (pcm) => {
          if (!closed && state() === 'speaking') {
            ws.send(pcm);
          }
        },
        onError: (message) => log('warn', 'voice tts error', { userId: uid, error: message }),
      });
    }

    async function beginTurn(text: string) {
      box.value = 'thinking';
      send(ws, { type: 'state', state: 'thinking' });
      send(ws, { type: 'user-transcript', text, final: true });
      currentUserText = text;

      const userMessageId = await deps.store.saveTurn({
        userId: uid,
        conversationId: ctx.conversationId,
        parentMessageId: ctx.parentMessageId ?? null,
        role: 'user',
        text,
      });
      if (userMessageId) {
        ctx.parentMessageId = userMessageId;
      }

      spokenSentences = '';
      const splitter = createSentenceSplitter();
      const history: VoiceChatMessage[] = [
        {
          role: 'system',
          content:
            deps.config.voiceStyle +
            (ctx.instructions ? `\n\nAdditional instructions:\n${ctx.instructions}` : ''),
        },
        ...ctx.turns.map((turn) => ({ role: turn.role, content: turn.text }) as VoiceChatMessage),
        { role: 'user', content: text },
      ];

      const speakSentence = (sentence: string) => {
        if (!tts?.usable) {
          tts = openTts(voice?.id);
        }
        spokenSentences += (spokenSentences ? ' ' : '') + sentence;
        tts.speak(sentence);
        if (state() === 'thinking') {
          box.value = 'speaking';
          send(ws, { type: 'state', state: 'speaking' });
        }
      };

      abort = new AbortController();
      turnInterrupted = false;
      try {
        const full = await chat({
          baseUrl: deps.llm.baseUrl,
          apiKey: deps.llm.apiKey,
          model: deps.config.llmModel,
          messages: history,
          maxTokens: deps.config.maxTokens,
          temperature: deps.config.temperature,
          signal: abort.signal,
          onDelta: (delta) => {
            for (const sentence of splitter.push(delta)) {
              speakSentence(sentence);
            }
          },
        });
        if (closed || turnInterrupted) {
          // The interrupt (or disconnect) already persisted the truncated
          // turn and notified the client; the aborted stream resolves late.
          return;
        }
        if (state() === 'speaking') {
          const tail = splitter.tail();
          if (tail) {
            speakSentence(tail);
          }
          await finishTurn(full.trim() || spokenSentences.trim());
        } else {
          // Nothing was spoken (empty reply) → straight back to listening.
          await finishTurn(full.trim());
          backToListening();
        }
      } catch (err) {
        if (closed || turnInterrupted) {
          return;
        }
        log('error', 'voice llm failed', { userId: uid, error: (err as Error).message });
        await persistAssistant(spokenSentences.trim());
        send(ws, { type: 'error', code: 'server', message: 'The voice reply failed' });
        backToListening();
      } finally {
        abort = null;
      }
    }

    /** Persist the assistant turn and advance the chain anchor. */
    async function finishTurn(text: string) {
      if (!text) {
        return;
      }
      const messageId = await deps.store.saveTurn({
        userId: uid,
        conversationId: ctx.conversationId,
        parentMessageId: ctx.parentMessageId ?? null,
        role: 'assistant',
        text,
      });
      if (messageId) {
        ctx.parentMessageId = messageId;
      }
      ctx.turns.push({ role: 'user', text: currentUserText });
      ctx.turns.push({ role: 'assistant', text });
      if (ctx.turns.length > deps.config.maxContextTurns * 2) {
        ctx.turns.splice(0, ctx.turns.length - deps.config.maxContextTurns * 2);
      }
      currentUserText = '';
      send(ws, { type: 'assistant-transcript', text });
    }

    async function persistAssistant(text: string) {
      if (text) {
        await finishTurn(text);
      }
    }

    /** Client detected speech during playback: stop the reply, keep what was said. */
    function interrupt() {
      if (state() !== 'speaking' && state() !== 'thinking') {
        return;
      }
      abort?.abort();
      abort = null;
      turnInterrupted = true;
      const kept = spokenSentences.trim();
      spokenSentences = '';
      if (kept) {
        send(ws, { type: 'interrupted', text: kept });
        void deps.store
          .saveTurn({
        userId: uid,
            conversationId: ctx.conversationId,
            parentMessageId: ctx.parentMessageId ?? null,
            role: 'assistant',
            text: kept,
          })
          .then((messageId) => {
            if (messageId) {
              ctx.parentMessageId = messageId;
            }
            ctx.turns.push({ role: 'user', text: currentUserText });
            ctx.turns.push({ role: 'assistant', text: kept });
            if (ctx.turns.length > deps.config.maxContextTurns * 2) {
              ctx.turns.splice(0, ctx.turns.length - deps.config.maxContextTurns * 2);
            }
            currentUserText = '';
          });
      }
      backToListening();
    }

    function backToListening() {
      box.value = 'listening';
      send(ws, { type: 'state', state: 'listening' });
    }

    function send(socket: VoiceSocket, message: ServerVoiceMessage) {
      if (!closed) {
        socket.send(JSON.stringify(message));
      }
    }

    function close(reason = 'server closing') {
      if (closed) {
        return;
      }
      closed = true;
      sessions.delete(uid);
      clearInterval(meter);
      clearInterval(ping);
      clearInterval(silence);
      abort?.abort();
      // Wall-clock metering: bill the part-interval remainder since the last
      // tick, capped so a restart loop can't double-bill a full interval.
      const elapsed = Math.min(METER_INTERVAL_SECONDS, Math.max(0, Math.round((now() - meterAnchor) / 1000)));
      if (elapsed > 0) {
        deps.addSeconds(uid, tier, elapsed);
      }
      try {
        stt?.close();
        tts?.close();
      } catch {
        /* sockets already gone */
      }
      try {
        ws.close(1000, reason);
      } catch {
        /* socket already gone */
      }
    }
  }
}
