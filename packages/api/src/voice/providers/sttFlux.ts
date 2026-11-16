import WebSocket from 'ws';

/**
 * Streaming STT adapter for @cf/deepgram/flux (conversational, native
 * end-of-turn). Input: raw signed little-endian 16-bit PCM. Output: JSON
 * events (`Update` → interim, `EndOfTurn` → turn complete).
 */
export type FluxEvent =
  | { kind: 'interim'; text: string }
  | { kind: 'end-of-turn'; text: string }
  | { kind: 'error'; message: string };

export interface FluxStt {
  sendAudio(chunk: Buffer): void;
  close(): void;
  /** False once the socket errored or closed; callers reopen lazily. */
  readonly usable: boolean;
}

/** Pure parser, exported for specs. */
export function parseFluxMessage(data: string): FluxEvent | null {
  let msg: { event?: string; transcript?: string };
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  switch (msg.event) {
    case 'Update':
    case 'EagerEndOfTurn':
      return { kind: 'interim', text: msg.transcript ?? '' };
    case 'EndOfTurn':
      return { kind: 'end-of-turn', text: msg.transcript ?? '' };
    default:
      // StartOfTurn, TurnResumed, keepalives: nothing to act on.
      return null;
  }
}

export function openFluxStt(opts: {
  accountId: string;
  token: string;
  model?: string;
  sampleRate?: number;
  eotThreshold?: number;
  eotTimeoutMs?: number;
  onEvent: (event: FluxEvent) => void;
}): FluxStt {
  const model = opts.model || '@cf/deepgram/flux';
  const url =
    `wss://api.cloudflare.com/client/v4/accounts/${opts.accountId}/ai/run/${model}` +
    `?encoding=linear16&sample_rate=${opts.sampleRate || 16000}` +
    `&eot_threshold=${opts.eotThreshold ?? 0.7}&eot_timeout_ms=${opts.eotTimeoutMs ?? 2500}`;
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${opts.token}` } });
  let usable = true;
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      return;
    }
    const event = parseFluxMessage(String(data));
    if (event) {
      opts.onEvent(event);
    }
  });
  ws.on('error', (err) => {
    usable = false;
    opts.onEvent({ kind: 'error', message: err.message });
  });
  ws.on('close', () => {
    usable = false;
  });
  return {
    sendAudio: (chunk) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    },
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
