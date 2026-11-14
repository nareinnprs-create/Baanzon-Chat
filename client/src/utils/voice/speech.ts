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
 * the session language, then one flagged as premium/neural/natural, then the
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
  const premium = pool.find((voice) =>
    /natural|neural|premium|enhanced|google|siri/i.test(voice.name),
  );
  return premium ?? pool.find((voice) => voice.default) ?? pool[0] ?? null;
}
