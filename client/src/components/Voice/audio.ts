/**
 * Diya audio client: speech in (server Whisper) and speech out (server TTS).
 *
 * Both legs talk to our API, so the device never contributes a voice, a
 * locale or a language pack - every user hears the same fixed female voice
 * per language, and any language the server supports is recognized and
 * spoken regardless of browser settings.
 */

const SCRIPT_LANG: Array<[RegExp, string]> = [
  [/[\u0900-\u097F]/, 'hi'],
  [/[\u0980-\u09FF]/, 'bn'],
  [/[\u0A00-\u0A7F]/, 'pa'],
  [/[\u0A80-\u0AFF]/, 'gu'],
  [/[\u0B00-\u0B7F]/, 'or'],
  [/[\u0B80-\u0BFF]/, 'ta'],
  [/[\u0C00-\u0C7F]/, 'te'],
  [/[\u0C80-\u0CFF]/, 'kn'],
  [/[\u0D00-\u0D7F]/, 'ml'],
];

/** Language of a text by its script; Latin text stays English. */
export function detectLang(text: string, fallback = 'en'): string {
  for (const [pattern, lang] of SCRIPT_LANG) {
    if (pattern.test(text)) {
      return lang;
    }
  }
  return fallback;
}

function authHeaders(token?: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function blobToBase64(blob: Blob): Promise<string> {
  // FileReader works in every target browser and in jsdom, unlike Blob.arrayBuffer.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('could not read audio'));
    reader.readAsDataURL(blob);
  });
}

export interface TranscriptionResult {
  text: string;
  language: string | null;
}

/** Speech in: audio blob -> transcript (+ detected language). */
export async function transcribeAudio(
  blob: Blob,
  token?: string | null,
): Promise<TranscriptionResult> {
  const audio = await blobToBase64(blob);
  const response = await fetch('/api/voice/stt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ audio }),
  });
  if (!response.ok) {
    throw new Error(`transcription failed (${response.status})`);
  }
  const data = await response.json();
  return {
    text: typeof data?.text === 'string' ? data.text : '',
    language: typeof data?.language === 'string' ? data.language : null,
  };
}

/** Speech out: text -> playable audio blob in the fixed Diya voice. */
export async function synthesizeSpeech(
  text: string,
  lang: string,
  token?: string | null,
): Promise<Blob> {
  const response = await fetch('/api/voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ text, lang }),
  });
  if (!response.ok) {
    throw new Error(`speech synthesis failed (${response.status})`);
  }
  return response.blob();
}
