/**
 * Voice-activity detection (P5.2) — pure, dependency-free core.
 *
 * The detector never touches WebAudio. It consumes a normalised amplitude in
 * the range 0..1 through {@link VoiceActivityDetector.push} and reports the
 * transitions that amplitude causes. A browser adapter (`./webAudioVad`) turns
 * an `AudioContext`/`AnalyserNode` into the {@link AudioLevelSampler} this
 * module samples, which keeps the timing logic deterministic and unit-testable
 * under jsdom.
 */

/** The detector's judgement at a point in time. */
export type VoiceActivityState = 'silence' | 'speaking';

/** A transition emitted by {@link VoiceActivityDetector.push}, otherwise `null`. */
export type VoiceActivityEvent = 'speech-start' | 'speech-end';

/** Two-threshold + hangover configuration, all optional with sane defaults. */
export interface VadOptions {
  /** Level at or above which the detector enters `speaking`. Default `0.2`. */
  speakingThreshold?: number;
  /** Level below which, sustained for `hangoverMs`, speech ends. Default `0.1`. */
  silenceThreshold?: number;
  /** How long the level may stay silent before `speech-end` fires. Default `800`. */
  hangoverMs?: number;
  /** Shortest run above `speakingThreshold` that counts, to reject clicks. Default `0`. */
  minSpeechMs?: number;
}

/** Read-only view of the detector for rendering a level meter or a state badge. */
export interface VoiceActivitySnapshot {
  state: VoiceActivityState;
  level: number;
  /** Time the current speech run began, or `null` while silent. */
  speechStartedAt: number | null;
}

/** The detector surface. `push` is the only input; everything else observes. */
export interface VoiceActivityDetector {
  /** Feeds one normalised level (0..1) and returns the transition it caused. */
  push(level: number, atMs?: number): VoiceActivityEvent | null;
  snapshot(): VoiceActivitySnapshot;
  reset(): void;
}

/**
 * An injected source of normalised microphone amplitude. The pure detector and
 * the mic-level meter both read through this, so a test can drive either with a
 * plain function.
 */
export interface AudioLevelSampler {
  /** Current amplitude, clamped by the caller to 0..1. */
  sample(): number;
  /** Releases any underlying audio resources; safe to call more than once. */
  dispose(): void;
}

const DEFAULT_SPEAKING_THRESHOLD = 0.2;
const DEFAULT_SILENCE_THRESHOLD = 0.1;
const DEFAULT_HANGOVER_MS = 800;
const DEFAULT_MIN_SPEECH_MS = 0;

const clamp01 = (value: number): number => {
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
};

/**
 * Builds a two-threshold voice-activity detector.
 *
 * Entering speech needs the level to reach `speakingThreshold` and hold for
 * `minSpeechMs` (0 by default). Leaving it needs the level to fall below
 * `silenceThreshold` and stay there for `hangoverMs`, which is what keeps a
 * natural pause inside a sentence from reading as the end of a turn. A level
 * between the two thresholds is hysteresis: silent stays silent, speaking
 * stays speaking.
 */
export function createVoiceActivityDetector(options: VadOptions = {}): VoiceActivityDetector {
  const speakingThreshold = options.speakingThreshold ?? DEFAULT_SPEAKING_THRESHOLD;
  const silenceThreshold = options.silenceThreshold ?? DEFAULT_SILENCE_THRESHOLD;
  const hangoverMs = options.hangoverMs ?? DEFAULT_HANGOVER_MS;
  const minSpeechMs = options.minSpeechMs ?? DEFAULT_MIN_SPEECH_MS;

  let state: VoiceActivityState = 'silence';
  let level = 0;
  let speechStartedAt: number | null = null;
  let lastAboveAt: number | null = null;
  let pendingSince: number | null = null;

  const push = (nextLevel: number, atMs: number = Date.now()): VoiceActivityEvent | null => {
    level = clamp01(nextLevel);

    if (state === 'silence') {
      if (level < speakingThreshold) {
        pendingSince = null;
        return null;
      }
      if (pendingSince === null) {
        pendingSince = atMs;
      }
      if (atMs - pendingSince < minSpeechMs) {
        return null;
      }
      state = 'speaking';
      speechStartedAt = pendingSince;
      lastAboveAt = atMs;
      pendingSince = null;
      return 'speech-start';
    }

    if (level >= silenceThreshold) {
      lastAboveAt = atMs;
      return null;
    }

    const silentSince = lastAboveAt ?? atMs;
    if (atMs - silentSince < hangoverMs) {
      return null;
    }

    state = 'silence';
    speechStartedAt = null;
    pendingSince = null;
    return 'speech-end';
  };

  const snapshot = (): VoiceActivitySnapshot => ({ state, level, speechStartedAt });

  const reset = (): void => {
    state = 'silence';
    level = 0;
    speechStartedAt = null;
    lastAboveAt = null;
    pendingSince = null;
  };

  return { push, snapshot, reset };
}
