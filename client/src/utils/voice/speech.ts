/**
 * Web Speech adapters for Diya Orb. Everything here guards the browser globals
 * so the module stays import-safe under jsdom and on unsupported browsers.
 */

/** Minimal shape of the vendor-prefixed `SpeechRecognition` constructor. */
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}

export interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

export interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

/** `true` when this browser can run a full Diya Orb session. */
export function isDiyaVoiceSupported(): boolean {
  return typeof window === 'undefined'
    ? false
    : getRecognitionCtor() != null &&
        typeof window.speechSynthesis?.speak === 'function' &&
        typeof SpeechSynthesisUtterance !== 'undefined';
}

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Builds a continuous recognizer for one session. Returns `null` when the
 * browser lacks the API. The caller wires `onresult` / `onerror` / `onend`.
 */
export function createRecognizer(lang: string): SpeechRecognitionLike | null {
  const Ctor = getRecognitionCtor();
  if (Ctor == null) {
    return null;
  }
  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  return recognition;
}

/**
 * Picks the best installed voice for the assistant: prefer a voice matching
 * the session language, then a natural/neural/premium one flagged female
 * (Diya is a female assistant), then any premium/neural voice, then the
 * browser default.
 */
export function pickAssistantVoice(lang: string): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || typeof speechSynthesis === 'undefined') {
    return null;
  }
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) {
    return null;
  }
  const langPrefix = lang.slice(0, 2).toLowerCase();
  const matches = voices.filter((voice) => voice.lang.toLowerCase().startsWith(langPrefix));
  const pool = matches.length > 0 ? matches : voices;
  const premium = pool.filter((voice) =>
    /natural|neural|premium|enhanced|google|siri/i.test(voice.name),
  );
  const female = /female|woman|zira|aria|jenny|libby|sonia|samantha|karen|moira|tessa|fiona|neerja|kalpana|swara|heera|asha|priya|salli|kendra|kimberly|joanna|raveena|heami|yuna|kyoko|mei|amélie|ana|helena|paulina|monica/i;
  return premium.find((voice) => female.test(voice.name)) ?? premium[0] ?? pool.find((voice) => voice.default) ?? pool[0] ?? null;
}

/**
 * Primes the speech engine from inside a user gesture. Mobile engines drop
 * `speak()` when its first call happens after an await (the Diya turn fetch),
 * so the session start queues a silent utterance within the tap. Stateless by
 * design: repeated silent utterances are ignored by the engines, so no
 * once-per-page bookkeeping is needed.
 */
export function unlockSpeechSynthesis(): void {
  if (
    typeof window === 'undefined' ||
    typeof window.speechSynthesis?.speak !== 'function' ||
    typeof SpeechSynthesisUtterance === 'undefined'
  ) {
    return;
  }
  try {
    const utterance = new SpeechSynthesisUtterance(' ');
    utterance.volume = 0;
    window.speechSynthesis.speak(utterance);
    window.speechSynthesis.resume();
  } catch {
    /* Blocked or unsupported; real speech stays guarded by its own callers. */
  }
}
