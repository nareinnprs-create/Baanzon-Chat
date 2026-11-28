import type { FluxEvent, FluxStt } from './providers/sttFlux';
import type { VoiceSocket } from './session';
import { createVoiceGateway, type VoiceGatewayDeps } from './session';
import { DEFAULT_VOICE_CONFIG } from './config';

/** Fake browser socket: records sends, dispatches through captured handlers. */
function fakeSocket() {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const sends: Array<string | Buffer> = [];
  let closed = 0;
  const ws: VoiceSocket = {
    on: ((event: string, cb: (...args: unknown[]) => void) => {
      (handlers[event] ??= []).push(cb);
    }) as VoiceSocket['on'],
    send: (data) => sends.push(data),
    ping: () => {},
    close: () => {
      closed += 1;
    },
  };
  return {
    ws,
    sends,
    json: () => sends.filter((s) => typeof s === 'string').map((s) => JSON.parse(s as string)),
    closeCount: () => closed,
    emitMessage: (data: string | Buffer, isBinary = false) => {
      for (const cb of handlers.message ?? []) {
        cb(data as never, isBinary);
      }
    },
    emitClose: () => {
      for (const cb of handlers.close ?? []) {
        cb();
      }
    },
  };
}

/** Fake flux STT: the spec drives its event callback directly. */
function fakeStt(events: FluxEvent[]) {
  const audio: Buffer[] = [];
  let onEvent: ((e: FluxEvent) => void) | null = null;
  const stt: FluxStt = {
    sendAudio: (chunk) => audio.push(chunk),
    close: () => {},
    get usable() {
      return true;
    },
  };
  return {
    stt,
    audio,
    open: (opts: { onEvent: (e: FluxEvent) => void }) => {
      onEvent = opts.onEvent;
      return stt;
    },
    fire: () => {
      for (const e of events) {
        onEvent?.(e);
      }
    },
  };
}

/** Mono 16-bit WAV fixture: the sidecar's TTS output shape. */
function wav(samples: number[], rate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => data.writeInt16LE(sample, i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function makeDeps(overrides: Partial<VoiceGatewayDeps> = {}): {
  deps: VoiceGatewayDeps;
  saveTurns: Array<{ role: string; text: string }>;
  spoken: string[];
} {
  const saveTurns: Array<{ role: string; text: string }> = [];
  const spoken: string[] = [];
  const deps: VoiceGatewayDeps = {
    config: { ...DEFAULT_VOICE_CONFIG, eotTimeoutMs: 2500 },
    cf: { accountId: 'acc', token: 'cf-token' },
    llm: { baseUrl: 'https://llm.example/v1', apiKey: 'llm-key' },
    verifyToken: async () => 'user-1',
    tierOf: async () => 'free',
    usedSeconds: async () => 0,
    addSeconds: () => {},
    /** Default off in tests; whisper-path specs override with a fake. */
    whisper: async () => null,
    store: {
      loadContext: async () => ({
        conversationId: '11111111-1111-4111-8111-111111111111',
        turns: [],
        parentMessageId: null,
      }),
      saveTurn: async (input) => {
        saveTurns.push({ role: input.role, text: input.text });
        return `msg-${saveTurns.length}`;
      },
    },
    createStt: undefined,
    createTts: (opts) => ({
      speak: (text) => {
        spoken.push(text);
        if (spoken.length >= 2) {
          opts.onAudio(Buffer.from('pcm'));
        }
      },
      flush: () => {},
      close: () => {},
      get usable() {
        return true;
      },
    }),
    chat: async (opts) => {
      for (const piece of ['Hello there. ', 'Second sentence.']) {
        opts.onDelta(piece);
      }
      return 'Hello there. Second sentence.';
    },
    now: () => 1000,
    ...overrides,
  };
  return { deps, saveTurns, spoken };
}

describe('voice session', () => {
  it('rejects unauthenticated connections', async () => {
    const { deps } = makeDeps({ verifyToken: async () => null });
    const gateway = createVoiceGateway(deps);
    const client = fakeSocket();
    await gateway.handleConnection(client.ws, { token: 'bad' });
    expect(client.json()[0]).toMatchObject({ type: 'error', code: 'auth' });
    expect(client.closeCount()).toBe(1);
  });

  it('runs a full turn: audio → end-of-turn → spoken sentences → persisted turns', async () => {
    const stt = fakeStt([
      { kind: 'interim', text: 'hel' },
      { kind: 'end-of-turn', text: 'hello there' },
    ]);
    const { deps, saveTurns, spoken } = makeDeps({ createStt: stt.open });
    const gateway = createVoiceGateway(deps);
    const client = fakeSocket();
    await gateway.handleConnection(client.ws, { token: 'jwt', cid: undefined });

    expect(client.json()).toEqual([
      expect.objectContaining({ type: 'ready' }),
      { type: 'state', state: 'listening' },
    ]);

    client.emitMessage(JSON.stringify({ type: 'start' }));
    client.emitMessage(Buffer.from('audio'), true);
    stt.fire();

    await new Promise((r) => setTimeout(r, 5));
    const msgs = client.json();
    expect(msgs.some((m) => m.type === 'user-transcript' && m.final === true)).toBe(true);
    expect(spoken).toEqual(['Hello there.', 'Second sentence.']);
    expect(msgs.filter((m) => m.type === 'state').map((m) => m.state)).toEqual([
      'listening',
      'thinking',
      'speaking',
    ]);
    expect(
      msgs.some(
        (m) => m.type === 'assistant-transcript' && m.text === 'Hello there. Second sentence.',
      ),
    ).toBe(true);
    expect(saveTurns.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(saveTurns[1].text).toBe('Hello there. Second sentence.');
  });

  it('barge-in aborts the reply, persists only spoken sentences, returns to listening', async () => {
    const stt = fakeStt([{ kind: 'end-of-turn', text: 'tell me a long story' }]);
    const { deps, saveTurns, spoken } = makeDeps({
      createStt: stt.open,
      chat: (opts) =>
        new Promise((resolve) => {
          opts.onDelta('Once. ');
          // Simulate the abort arriving while the stream is still open.
          opts.signal?.addEventListener('abort', () => resolve('Once. Once.'));
        }),
    });
    const gateway = createVoiceGateway(deps);
    const client = fakeSocket();
    await gateway.handleConnection(client.ws, { token: 'jwt' });
    client.emitMessage(JSON.stringify({ type: 'start' }));
    stt.fire();
    await new Promise((r) => setTimeout(r, 5));
    client.emitMessage(JSON.stringify({ type: 'barge-in' }));
    await new Promise((r) => setTimeout(r, 5));

    const msgs = client.json();
    expect(msgs.some((m) => m.type === 'interrupted' && m.text === 'Once.')).toBe(true);
    expect(msgs.some((m) => m.type === 'state' && m.state === 'listening')).toBe(true);
    expect(saveTurns.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(saveTurns[1].text).toBe('Once.');
    // No further sentences are spoken after the interrupt.
    expect(spoken).toEqual(['Once.']);
  });

  it('replaces a previous session for the same user', async () => {
    const { deps } = makeDeps();
    const gateway = createVoiceGateway(deps);
    const first = fakeSocket();
    const second = fakeSocket();
    await gateway.handleConnection(first.ws, { token: 'jwt' });
    await gateway.handleConnection(second.ws, { token: 'jwt' });
    expect(first.closeCount()).toBe(1);
    expect(second.closeCount()).toBe(0);
  });

  it('re-decodes non-Latin turns with whisper and speaks them with the server voice', async () => {
    const stt = fakeStt([{ kind: 'end-of-turn', text: 'gujarati words' }]);
    const whisperCalls: Buffer[] = [];
    const synthCalls: Array<{ text: string; lang: string }> = [];
    const { deps, saveTurns, spoken } = makeDeps({
      createStt: stt.open,
      whisper: async (opts) => {
        whisperCalls.push(opts.audio);
        return { text: 'gujarati transcript', language: 'gu' };
      },
      synthesize: async (text, lang) => {
        synthCalls.push({ text, lang });
        return { buffer: wav([100, 200, 300, 400], 16000), mime: 'audio/wav' };
      },
    });
    const gateway = createVoiceGateway(deps);
    const client = fakeSocket();
    await gateway.handleConnection(client.ws, { token: 'jwt' });
    client.emitMessage(JSON.stringify({ type: 'start' }));
    client.emitMessage(Buffer.from('pcm-audio'), true);
    stt.fire();
    await new Promise((r) => setTimeout(r, 25));

    const msgs = client.json();
    // flux's English-guessed transcript is replaced by the whisper text.
    expect(msgs.some((m) => m.type === 'user-transcript' && m.text === 'gujarati transcript')).toBe(
      true,
    );
    // Playback is synthesized server-side: aura never speaks, and no client
    // voice handoff is announced.
    expect(msgs.some((m) => m.type === 'tts-mode' && m.engine === 'client')).toBe(false);
    expect(spoken).toEqual([]);
    expect(whisperCalls.length).toBe(1);
    expect(synthCalls.map((c) => c.lang)).toEqual(['gu', 'gu']);
    // 16 kHz -> 24 kHz: 4 samples in, 6 samples out, pushed as PCM frames.
    const audio = client.sends.filter((s): s is Buffer => Buffer.isBuffer(s));
    expect(audio.map((b) => b.length)).toEqual([12, 12]);
    expect(saveTurns.map((t) => t.text)).toEqual([
      'gujarati transcript',
      'Hello there. Second sentence.',
    ]);
    expect(
      msgs.some(
        (m) => m.type === 'assistant-transcript' && m.text === 'Hello there. Second sentence.',
      ),
    ).toBe(true);
  });

  it('caps out users with no remaining seconds', async () => {
    const { deps } = makeDeps({ usedSeconds: async () => 601 });
    const gateway = createVoiceGateway(deps);
    const client = fakeSocket();
    await gateway.handleConnection(client.ws, { token: 'jwt' });
    expect(client.json()[0]).toMatchObject({ type: 'error', code: 'cap' });
    expect(client.closeCount()).toBe(1);
  });
});
