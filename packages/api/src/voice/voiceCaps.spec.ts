import { DEFAULT_VOICE_CONFIG, VOICE_SPEAKERS, buildVoiceConfig, voiceClientConfig } from './config';
import { VOICE_TIER_MINUTES, normalizeTier, remainingSeconds, voiceDayKey } from './caps';
import { createSentenceSplitter } from './providers/sentences';
import { parseFluxMessage } from './providers/sttFlux';

describe('voice caps', () => {
  it('keeps the approved tier minutes', () => {
    expect(VOICE_TIER_MINUTES).toEqual({ free: 10, lite: 30, pro: 120, enterprise: 400 });
  });

  it('normalizes unknown tiers to free', () => {
    expect(normalizeTier('pro')).toBe('pro');
    expect(normalizeTier('LITE')).toBe('lite');
    expect(normalizeTier(undefined)).toBe('free');
    expect(normalizeTier('nope')).toBe('free');
  });

  it('computes remaining seconds and floors at zero', () => {
    expect(remainingSeconds('free', 0)).toBe(600);
    expect(remainingSeconds('free', 599)).toBe(1);
    expect(remainingSeconds('free', 700)).toBe(0);
  });

  it('formats the IST day key as en-CA date', () => {
    expect(voiceDayKey(new Date('2026-01-01T20:30:00Z'))).toBe('2026-01-02');
  });
});

describe('voice config', () => {
  it('ships a generic client payload with no model identities', () => {
    const config = buildVoiceConfig({ defaultMode: 'hold-to-talk' });
    const payload = voiceClientConfig(config, 42);
    expect(payload).toEqual({
      enabled: true,
      voices: VOICE_SPEAKERS,
      defaultMode: 'hold-to-talk',
      captionsDefault: true,
      remainingSeconds: 42,
    });
    expect(JSON.stringify(payload)).not.toMatch(/aura|flux|llama|cf\//i);
    expect(DEFAULT_VOICE_CONFIG.voices).toHaveLength(6);
  });
});

describe('sentence splitter', () => {
  it('emits complete sentences across deltas', () => {
    const splitter = createSentenceSplitter();
    expect(splitter.push('Hello there. ')).toEqual(['Hello there.']);
    expect(splitter.push('How are')).toEqual([]);
    expect(splitter.push(' you? Fine.')).toEqual(['How are you?']);
    expect(splitter.tail()).toBe('Fine.');
  });

  it('keeps decimals intact', () => {
    const splitter = createSentenceSplitter();
    expect(splitter.push('Pi is 3.14 and counting')).toEqual([]);
    expect(splitter.tail()).toBe('Pi is 3.14 and counting');
  });

  it('force-splits runaway text at a soft boundary', () => {
    const splitter = createSentenceSplitter(60);
    const out = splitter.push('word '.repeat(30));
    expect(out).toHaveLength(1);
    expect(out[0].length).toBeGreaterThan(40);
  });
});

describe('flux parser', () => {
  it('maps events', () => {
    expect(parseFluxMessage('{"event":"Update","transcript":"hel"}')).toEqual({
      kind: 'interim',
      text: 'hel',
    });
    expect(parseFluxMessage('{"event":"EndOfTurn","transcript":"hello"}')).toEqual({
      kind: 'end-of-turn',
      text: 'hello',
    });
    expect(parseFluxMessage('{"event":"TurnResumed"}')).toBeNull();
    expect(parseFluxMessage('not json')).toBeNull();
    expect(parseFluxMessage('{"event":"EagerEndOfTurn","transcript":"x"}')).toEqual({
      kind: 'interim',
      text: 'x',
    });
  });
});
