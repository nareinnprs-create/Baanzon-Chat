import { createVoiceActivityDetector } from '../vad';
import { rmsToLevel } from '../webAudioVad';

/**
 * Regression for the orb never recording: the detector's speaking threshold is
 * 0.2, while raw microphone RMS for speech is ~0.01-0.15. Without the scale the
 * VAD never saw speech and Diya sat listening forever.
 */
describe('rmsToLevel', () => {
  it('lifts ordinary speech above the detector threshold', () => {
    // -20 dBFS speech (0.1 amplitude) has RMS ~0.07.
    expect(rmsToLevel(0.07)).toBeGreaterThan(0.2);
    const detector = createVoiceActivityDetector();
    expect(detector.push(rmsToLevel(0.07))).toBe('speech-start');
  });

  it('keeps room tone below the silence threshold', () => {
    expect(rmsToLevel(0.003)).toBeLessThan(0.1);
  });

  it('clamps loud input and ignores nonsense', () => {
    expect(rmsToLevel(0.9)).toBe(1);
    expect(rmsToLevel(Number.NaN)).toBe(0);
    expect(rmsToLevel(-0.5)).toBe(0);
  });
});
