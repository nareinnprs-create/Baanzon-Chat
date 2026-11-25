import { novaLanguage, novaUrl, parseNovaMessage } from './sttNova';

describe('parseNovaMessage', () => {
  const results = (transcript: string, isFinal: boolean, speechFinal: boolean) =>
    JSON.stringify({
      type: 'Results',
      channel: { alternatives: [{ transcript }] },
      is_final: isFinal,
      speech_final: speechFinal,
    });

  it('treats a non-final result as an interim caption', () => {
    expect(parseNovaMessage(results('vanak', false, false))).toEqual({
      kind: 'interim',
      text: 'vanak',
    });
  });

  it('buffers a final segment', () => {
    expect(parseNovaMessage(results('vanakkam', true, false))).toEqual({
      kind: 'final',
      text: 'vanakkam',
    });
  });

  it('ends the utterance on speech_final and on UtteranceEnd', () => {
    expect(parseNovaMessage(results('vanakkam diya', true, true))).toEqual({
      kind: 'utterance-end',
      text: 'vanakkam diya',
    });
    expect(parseNovaMessage(JSON.stringify({ type: 'UtteranceEnd' }))).toEqual({
      kind: 'utterance-end',
      text: '',
    });
  });

  it('ignores metadata, speech-start and malformed frames', () => {
    expect(parseNovaMessage(JSON.stringify({ type: 'Metadata' }))).toBeNull();
    expect(parseNovaMessage(JSON.stringify({ type: 'SpeechStarted' }))).toBeNull();
    expect(parseNovaMessage(results('   ', true, true))).toBeNull();
    expect(parseNovaMessage('not json')).toBeNull();
  });
});

describe('novaLanguage', () => {
  it('asks for multilingual streaming unless a language is pinned', () => {
    expect(novaLanguage(undefined)).toBe('multi');
    expect(novaLanguage('auto')).toBe('multi');
    expect(novaLanguage('ta')).toBe('ta');
    expect(novaLanguage('EN-in')).toBe('en');
  });
});

describe('novaUrl', () => {
  it('targets the multilingual streaming endpoint with endpointing', () => {
    const url = novaUrl({ accountId: 'acct', language: 'auto', sampleRate: 16000 });
    expect(url).toContain('/ai/run/@cf/deepgram/nova-3?');
    expect(url).toContain('language=multi');
    expect(url).toContain('sample_rate=16000');
    expect(url).toContain('endpointing=300');
    expect(url).toContain('utterance_end_ms=1000');
  });

  it('honours an operator-pinned model and language', () => {
    const url = novaUrl({ accountId: 'acct', model: '@cf/deepgram/nova-3', language: 'te' });
    expect(url).toContain('language=te');
  });
});
