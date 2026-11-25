/**
 * Voice-language resolution and Whisper hallucination filtering.
 *
 * Whisper's auto-detect is unreliable on the short, noisy clips a voice
 * assistant records: it labels Tamil/Telugu/Marathi speech as Hindi, and on
 * silence or background noise it emits canned phrases such as
 * "Продолжение следует..." with language "ru". Both are worse than no
 * transcript - a Russian "to be continued" became a user message, a Russian
 * reply and an English voice reading it.
 *
 * The rules here keep the pipeline inside the languages the voice stack can
 * actually speak: a reported language survives only if the reply text is in
 * the same script family, and text in a script we cannot voice is refused
 * instead of being read aloud by an English speaker.
 */

/** Languages the TTS ladder can speak (Kokoro + MMS + aura). */
export const VOICE_LANGS: ReadonlySet<string> = new Set([
  'en',
  'hi',
  'es',
  'fr',
  'it',
  'pt',
  'ja',
  'zh',
  'ta',
  'te',
  'bn',
  'gu',
  'kn',
  'ml',
  'pa',
  'or',
  'as',
  'mr',
]);

/** Indic scripts, most specific first (Devanagari is also Marathi/Nepali). */
const SCRIPT_LANG: ReadonlyArray<readonly [RegExp, string]> = [
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

/** Languages that share a writing system. */
const SCRIPT_FAMILY: Readonly<Record<string, string>> = {
  hi: 'devanagari',
  mr: 'devanagari',
  bn: 'bengali',
  as: 'bengali',
  pa: 'gurmukhi',
  gu: 'gujarati',
  or: 'odia',
  ta: 'tamil',
  te: 'telugu',
  kn: 'kannada',
  ml: 'malayalam',
  en: 'latin',
  es: 'latin',
  fr: 'latin',
  it: 'latin',
  pt: 'latin',
  ja: 'japanese',
  zh: 'han',
};

/**
 * Whisper's canned outputs for silence, music and noise. Matched after
 * lowercasing and stripping punctuation, so "Продолжение следует..." hits.
 */
const HALLUCINATIONS: readonly string[] = [
  'продолжение следует',
  'субтитры сделал',
  'субтитры создавал',
  'редактор субтитров',
  'спасибо за просмотр',
  'подписывайтесь на канал',
  'thank you for watching',
  'thanks for watching',
  'please subscribe',
  'subtitles by',
  'amara org',
  'ご視聴ありがとうございました',
  '字幕由',
  'sous titres',
  'untertitel',
];

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the transcript is a known Whisper artifact rather than speech. */
export function isLikelyHallucination(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }
  return HALLUCINATIONS.some((phrase) => normalized.includes(phrase));
}

/** The language a text is written in, or `null` for a script we cannot voice. */
export function scriptLang(text: string): string | null {
  for (const [pattern, lang] of SCRIPT_LANG) {
    if (pattern.test(text)) {
      return lang;
    }
  }
  return /[A-Za-z]/.test(text) ? 'en' : null;
}

/** Two-letter code when it is a language the voice stack can speak. */
export function normalizeVoiceLang(value: unknown): string | null {
  const code = String(value ?? '')
    .toLowerCase()
    .slice(0, 2);
  return VOICE_LANGS.has(code) ? code : null;
}

/** Scripts we have no voice for; text in them must not be read by another voice. */
const UNSUPPORTED_SCRIPT_RE =
  /[\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u0E00-\u0E7F\u10A0-\u10FF\uAC00-\uD7AF]/;

/**
 * The language to speak a text in.
 *
 * The text's script wins whenever it belongs to a different family than the
 * reported language: Whisper reporting "ru" for Tamil audio, or a session in
 * English answering in Tamil script, must still use the Tamil voice. Inside
 * one family the report wins, because script alone cannot tell Marathi from
 * Hindi. Returns `null` when nothing we can speak matches.
 */
export function resolveVoiceLang(reported: unknown, text: string): string | null {
  if (UNSUPPORTED_SCRIPT_RE.test(text)) {
    return null;
  }
  const direct = normalizeVoiceLang(reported);
  const fromText = scriptLang(text);
  if (fromText == null) {
    return direct;
  }
  if (direct != null && SCRIPT_FAMILY[direct] === SCRIPT_FAMILY[fromText]) {
    return direct;
  }
  return fromText;
}
