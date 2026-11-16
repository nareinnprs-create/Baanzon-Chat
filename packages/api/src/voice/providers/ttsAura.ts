import WebSocket from 'ws';

/**
 * Streaming TTS adapter for @cf/deepgram/aura. One WebSocket per voice
 * session: sentences are spoken as they arrive (`Speak` + `Flush` per
 * sentence) and raw linear16 PCM frames come back as binary messages.
 * Verified against the live CF endpoint: WS output is raw PCM16 (~24kHz),
 * not MP3.
 */
export interface AuraTts {
  speak(text: string): void;
  flush(): void;
  close(): void;
  readonly usable: boolean;
}

export function openAuraTts(opts: {
  accountId: string;
  token: string;
  model?: string;
  speaker?: string;
  onAudio: (pcm: Buffer) => void;
  onError: (message: string) => void;
}): AuraTts {
  const model = opts.model || '@cf/deepgram/aura-1';
  const url = `wss://api.cloudflare.com/client/v4/accounts/${opts.accountId}/ai/run/${model}`;
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${opts.token}` } });
  let usable = true;
  // Speaks that arrive while the socket is still connecting (e.g. a fresh
  // open inside speakSentence): ws.send would silently drop them, leaving a
  // reply with audio but no Speak behind it.
  const pending: string[] = [];
  const drainPending = () => {
    for (const text of pending.splice(0)) {
      send({ type: 'Speak', text });
      send({ type: 'Flush' });
    }
  };
  ws.on('open', drainPending);
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      opts.onAudio(data as Buffer);
      return;
    }
    // Metadata (request ids, usage) carries nothing the session needs.
  });
  ws.on('error', (err) => {
    usable = false;
    opts.onError(err.message);
  });
  ws.on('close', () => {
    usable = false;
  });
  const send = (obj: unknown) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  };
  return {
    speak: (text) => {
      if (ws.readyState === WebSocket.OPEN) {
        const message: Record<string, unknown> = { type: 'Speak', text };
        if (opts.speaker) {
          message.speaker = opts.speaker;
        }
        send(message);
        send({ type: 'Flush' });
        return;
      }
      pending.push(text);
    },
    flush: () => send({ type: 'Flush' }),
    close: () => {
      usable = false;
      try {
        ws.close();
      } catch {
        /* already gone */
      }
    },
    get usable() {
      return usable && ws.readyState === WebSocket.OPEN;
    },
  };
}
