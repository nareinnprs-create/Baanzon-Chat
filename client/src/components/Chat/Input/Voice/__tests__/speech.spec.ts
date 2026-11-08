import { applyTranscript, chunkForSpeech, pickVoiceForLanguage } from '../speech';

describe('applyTranscript', () => {
  it('inserts at the caret and pads so words do not glue together', () => {
    const result = applyTranscript('hello world', 'new text', null, 5);
    expect(result.text).toBe('hello new text world');
    expect(result.cursor).toBe('hello new text'.length);
    expect(result.slot).toEqual({ start: 5, length: 9 });
  });

  it('inserts at the end when no caret is given', () => {
    const result = applyTranscript('hello', 'world', null);
    expect(result.text).toBe('hello world');
    expect(result.cursor).toBe(result.text.length);
  });

  it('does not pad when the caret sits on whitespace boundaries', () => {
    const result = applyTranscript('hello ', 'world', null, 6);
    expect(result.text).toBe('hello world');
  });

  it('clamps an out-of-range caret to the text length', () => {
    const result = applyTranscript('abc', 'd', null, 99);
    expect(result.text).toBe('abc d');
  });

  it('rewrites exactly the owned range on interim updates', () => {
    const first = applyTranscript('I think ', 'hel', null, 8);
    expect(first.text).toBe('I think hel');
    const second = applyTranscript(first.text, 'hello there', first.slot);
    expect(second.text).toBe('I think hello there');
    expect(second.cursor).toBe('I think hello there'.length);
    expect(second.slot).toEqual({ start: 8, length: 11 });
  });

  it('keeps text after the slot when the caret was mid-text', () => {
    const first = applyTranscript('left | right', 'x', null, 7);
    const second = applyTranscript(first.text, 'xyz', first.slot);
    expect(second.text).toBe('left | xyz right');
  });
});

describe('chunkForSpeech', () => {
  it('returns an empty array for empty text', () => {
    expect(chunkForSpeech('')).toEqual([]);
    expect(chunkForSpeech('   ')).toEqual([]);
  });

  it('returns a single chunk for short text', () => {
    expect(chunkForSpeech('Hello there.')).toEqual(['Hello there.']);
  });

  it('splits on sentence boundaries and keeps each chunk under maxLen', () => {
    const text =
      'First sentence. Second sentence goes here! Third one asks a question? A fourth one follows.';
    const chunks = chunkForSpeech(text, 40);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(40);
    }
    expect(chunks.join(' ')).toBe(text);
  });

  it('hard-splits a single sentence longer than maxLen', () => {
    const sentence = 'a'.repeat(450);
    const chunks = chunkForSpeech(sentence, 200);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
  });

  it('collapses runs of whitespace', () => {
    expect(chunkForSpeech('Hello\n\n  world.\tOk.', 200)).toEqual(['Hello world. Ok.']);
  });
});

describe('pickVoiceForLanguage', () => {
  const voices = [
    { lang: 'fr-FR' },
    { lang: 'en-US' },
    { lang: 'en-GB' },
  ] as unknown as SpeechSynthesisVoice[];

  it('prefers the exact language match', () => {
    expect(pickVoiceForLanguage(voices, 'en-GB')).toBe(voices[2]);
  });

  it('falls back to the first voice with the same primary subtag', () => {
    expect(pickVoiceForLanguage(voices, 'en-AU')).toBe(voices[1]);
  });

  it('returns undefined when nothing matches', () => {
    expect(pickVoiceForLanguage(voices, 'de-DE')).toBeUndefined();
    expect(pickVoiceForLanguage(voices, '')).toBeUndefined();
  });
});
