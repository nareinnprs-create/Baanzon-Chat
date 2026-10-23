import type { VoiceActivityDetector } from '~/utils/voice/vad';
import { createVoiceActivityDetector } from '~/utils/voice/vad';

/** Thresholds chosen to make every crossing unambiguous in the assertions. */
function makeDetector(overrides = {}): VoiceActivityDetector {
  return createVoiceActivityDetector({
    speakingThreshold: 0.5,
    silenceThreshold: 0.2,
    hangoverMs: 300,
    minSpeechMs: 0,
    ...overrides,
  });
}

describe('createVoiceActivityDetector', () => {
  it('emits speech-start once the level reaches the speaking threshold', () => {
    const detector = makeDetector();

    expect(detector.push(0.1, 0)).toBeNull();
    expect(detector.snapshot().state).toBe('silence');

    expect(detector.push(0.5, 10)).toBe('speech-start');
    expect(detector.snapshot().state).toBe('speaking');
    expect(detector.snapshot().speechStartedAt).toBe(10);

    expect(detector.push(0.4, 20)).toBeNull();
    expect(detector.snapshot().state).toBe('speaking');
  });

  it('holds speech through the hangover and emits speech-end after it elapses', () => {
    const detector = makeDetector();

    detector.push(0.5, 10);
    expect(detector.push(0.4, 20)).toBeNull();

    expect(detector.push(0.1, 40)).toBeNull();
    expect(detector.snapshot().state).toBe('speaking');

    expect(detector.push(0.1, 310)).toBeNull();
    expect(detector.push(0.1, 330)).toBe('speech-end');
    expect(detector.snapshot().state).toBe('silence');
    expect(detector.snapshot().speechStartedAt).toBeNull();
  });

  it('does not start speech for a level between the two thresholds', () => {
    const detector = makeDetector();

    expect(detector.push(0.4, 0)).toBeNull();
    expect(detector.snapshot().state).toBe('silence');
    expect(detector.snapshot().speechStartedAt).toBeNull();
  });

  it('does not end speech for a level between the two thresholds', () => {
    const detector = makeDetector();

    detector.push(0.6, 10);
    expect(detector.push(0.3, 20)).toBeNull();
    expect(detector.snapshot().state).toBe('speaking');
  });

  it('uses the default thresholds when no options are supplied', () => {
    const detector = createVoiceActivityDetector();

    expect(detector.push(0.25, 0)).toBe('speech-start');
    expect(detector.push(0.15, 10)).toBeNull();
    expect(detector.push(0.05, 10)).toBeNull();
    expect(detector.push(0.05, 815)).toBe('speech-end');
  });

  it('waits for minSpeechMs before reporting speech', () => {
    const detector = makeDetector({ minSpeechMs: 50 });

    expect(detector.push(0.6, 0)).toBeNull();
    expect(detector.snapshot().state).toBe('silence');
    expect(detector.push(0.6, 40)).toBeNull();
    expect(detector.push(0.6, 50)).toBe('speech-start');
    expect(detector.snapshot().speechStartedAt).toBe(0);
  });

  it('discards a pending speech run when the level dips below the threshold', () => {
    const detector = makeDetector({ minSpeechMs: 50 });

    expect(detector.push(0.6, 0)).toBeNull();
    expect(detector.push(0.1, 60)).toBeNull();
    expect(detector.push(0.6, 100)).toBeNull();
    expect(detector.push(0.6, 149)).toBeNull();
    expect(detector.push(0.6, 150)).toBe('speech-start');
    expect(detector.snapshot().speechStartedAt).toBe(100);
  });

  it('clamps out-of-range levels instead of leaking them into the snapshot', () => {
    const detector = makeDetector();

    expect(detector.push(Number.NaN, 0)).toBeNull();
    expect(detector.snapshot().level).toBe(0);

    expect(detector.push(-5, 10)).toBeNull();
    expect(detector.snapshot().level).toBe(0);
  });

  it('reset returns the detector to a clean silent state', () => {
    const detector = makeDetector();

    detector.push(0.9, 0);
    expect(detector.snapshot().state).toBe('speaking');

    detector.reset();

    expect(detector.snapshot()).toEqual({ state: 'silence', level: 0, speechStartedAt: null });
    expect(detector.push(0.9, 500)).toBe('speech-start');
  });
});
