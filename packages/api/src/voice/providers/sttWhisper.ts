/**
 * REST STT adapter for @cf/openai/whisper-large-v3-turbo. flux streams
 * English; for anything else the session buffers the turn's PCM and hands
 * the whole utterance here at end-of-turn. One HTTP call per turn:
 * multilingual accuracy beats streaming latency on a language flux cannot
 * handle, and the response carries the detected language.
 */

/** Wraps raw linear16 mono PCM into a minimal WAV container (48-byte header). */
export function encodeWav(pcm: Buffer, sampleRate = 16000): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export interface WhisperSttResult {
  text: string;
  /** BCP-47-ish code from the model's transcription_info (e.g. 'hi'). */
  language: string;
}

/** Pure response parser, exported for specs. */
export function parseWhisperResponse(payload: unknown): WhisperSttResult | null {
  const result = (
    payload as { result?: { text?: unknown; transcription_info?: { language?: unknown } } }
  )?.result;
  const text = typeof result?.text === 'string' ? result.text.trim() : '';
  if (!text) {
    return null;
  }
  const language =
    typeof result?.transcription_info?.language === 'string'
      ? result.transcription_info.language
      : 'en';
  return { text, language };
}

export function sttWhisper(opts: {
  accountId: string;
  token: string;
  /** Raw linear16 mono PCM at `sampleRate`. */
  audio: Buffer;
  sampleRate?: number;
  model?: string;
  signal?: AbortSignal;
}): Promise<WhisperSttResult | null> {
  const model = opts.model || '@cf/openai/whisper-large-v3-turbo';
  const url = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/ai/run/${model}`;
  return fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: encodeWav(opts.audio, opts.sampleRate).toString('base64') }),
    signal: opts.signal,
  })
    .then(async (res) => (res.ok ? parseWhisperResponse(await res.json().catch(() => null)) : null))
    .catch(() => null);
}

/**
 * Script-based language guess for a flux transcript. flux only emits English,
 * so any meaningful non-Latin run means flux decoded audio it cannot handle
 * and the turn needs the whisper re-decode. Codes match what the reply
 * instruction sends the LLM.
 */
export function detectLanguage(text: string): string {
  const samples: [RegExp, string][] = [
    [/[\u0900-\u094F\u0951-\u097F]/, 'hi'], // Devanagari (hindi/marathi/nepali)
    [/[\u0A80-\u0AFF]/, 'gu'], // Gujarati
    [/[\u0B80-\u0BFF]/, 'ta'], // Tamil
    [/[\u0C00-\u0C7F]/, 'te'], // Telugu
    [/[\u0C80-\u0CFF]/, 'kn'], // Kannada
    [/[\u0D00-\u0D7F]/, 'ml'], // Malayalam
    [/[\u0980-\u09FF]/, 'bn'], // Bengali
    [/[\u0A00-\u0A7F]/, 'pa'], // Gurmukhi
    [/[\u0600-\u06FF]/, 'ar'], // Arabic script (ur/ar/fa)
    [/[\u0400-\u04FF]/, 'ru'], // Cyrillic
  ];
  for (const [pattern, code] of samples) {
    if (pattern.test(text)) {
      return code;
    }
  }
  return 'en';
}
