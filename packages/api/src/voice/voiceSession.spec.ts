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
    const stt = fakeStt([{ kind: 'interim', text: 'hel' }, { kind: 'end-of-turn', text: 'hello there' }]);
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
    expect(msgs.some((m) => m.type === 'assistant-transcript' && m.text === 'Hello there. Second sentence.')).toBe(true);
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

  it('caps out users with no remaining seconds', async () => {
    const { deps } = makeDeps({ usedSeconds: async () => 601 });
    const gateway = createVoiceGateway(deps);
    const client = fakeSocket();
    await gateway.handleConnection(client.ws, { token: 'jwt' });
    expect(client.json()[0]).toMatchObject({ type: 'error', code: 'cap' });
    expect(client.closeCount()).toBe(1);
  });
});
