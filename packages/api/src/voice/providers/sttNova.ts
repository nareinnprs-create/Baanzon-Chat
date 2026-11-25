import WebSocket from 'ws';
import type { FluxEvent, FluxStt, FluxSttOptions } from './sttFlux';

/**
 * Streaming STT for `@cf/deepgram/nova-3`.
 *
 * Flux only transcribes English, so the realtime session had to re-decode every
 * non-English turn with Whisper and then hand playback to the device's
 * speechSynthesis. Nova-3 accepts `language=multi` (verified against the live
 * endpoint) and streams every supported language, which is what lets one
 * pipeline serve all Indian languages.
 *
 * Protocol differences from Flux: Deepgram sends `Results` frames with
 * `is_final` / `speech_final` plus an `UtteranceEnd` marker instead of
 * `Update` / `EndOfTurn`. Final segments are accumulated until the utterance
 * ends, so the session receives one end-of-turn with the whole sentence.
 */

export type NovaEvent = FluxEvent;

/** Maps one Deepgram frame; exported for specs. */
export function parseNovaMessage(
  data: string,
): { kind: 'interim' | 'final' | 'utterance-end'; text: string } | null {
  let msg: {
    type?: string;
    channel?: { alternatives?: Array<{ transcript?: string }> };
    is_final?: boolean;
    speech_final?: boolean;
  };
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (msg.type === 'UtteranceEnd') {
    return { kind: 'utterance-end', text: '' };
  }
  if (msg.type !== 'Results') {
    // Metadata, SpeechStarted, keepalives: nothing to act on.
    return null;
  }
  const text = msg.channel?.alternatives?.[0]?.transcript ?? '';
  if (!text.trim()) {
    return null;
  }
  if (msg.speech_final) {
    return { kind: 'utterance-end', text };
  }
  return { kind: msg.is_final ? 'final' : 'interim', text };
}

/** `multi` when the operator did not pin a language, else the two-letter code. */
export function novaLanguage(language?: string): string {
  const code = String(language ?? '')
    .toLowerCase()
    .slice(0, 2);
  return /^[a-z]{2}$/.test(code) && code !== 'au' ? code : 'multi';
}

/** Streaming endpoint URL; exported so the query contract is testable. */
export function novaUrl(opts: {
  accountId: string;
  model?: string;
  sampleRate?: number;
  language?: string;
}): string {
  const model = opts.model || '@cf/deepgram/nova-3';
  return (
    `wss://api.cloudflare.com/client/v4/accounts/${opts.accountId}/ai/run/${model}` +
    `?encoding=linear16&sample_rate=${opts.sampleRate || 16000}` +
    `&language=${novaLanguage(opts.language)}` +
    '&interim_results=true&endpointing=300&utterance_end_ms=1000&vad_events=true&punctuate=true'
  );
}

export interface NovaSttOptions extends FluxSttOptions {
  /** `auto` (or unset) asks Nova for multilingual streaming. */
  language?: string;
}

export function openNovaStt(opts: NovaSttOptions): FluxStt {
  const url = novaUrl(opts);
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${opts.token}` } });
  let usable = true;
  let pending: string[] = [];
  let emitted = '';

  const flush = () => {
    const text = pending.join(' ').trim();
    pending = [];
    if (text && text !== emitted) {
      emitted = text;
      opts.onEvent({ kind: 'end-of-turn', text });
    }
  };

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      return;
    }
    const event = parseNovaMessage(String(data));
    if (!event) {
      return;
    }
    if (event.kind === 'utterance-end') {
      if (event.text && pending[pending.length - 1] !== event.text) {
        pending.push(event.text);
      }
      flush();
      return;
    }
    if (event.kind === 'final') {
      if (pending[pending.length - 1] !== event.text) {
        pending.push(event.text);
      }
      return;
    }
    opts.onEvent({ kind: 'interim', text: event.text });
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
        ws.send(JSON.stringify({ type: 'CloseStream' }));
      } catch {
        /* already gone */
      }
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
