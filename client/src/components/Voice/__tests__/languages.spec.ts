import { readVoiceLanguage, writeVoiceLanguage } from '../languages';

describe('voice language preference', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to automatic detection', () => {
    expect(readVoiceLanguage()).toBe('');
  });

  it('round-trips a supported choice', () => {
    writeVoiceLanguage('te');
    expect(readVoiceLanguage()).toBe('te');
  });

  it('ignores a stored value the voice stack cannot speak', () => {
    localStorage.setItem('baanzon-voice-language', 'ru');
    expect(readVoiceLanguage()).toBe('');
  });

  it('restores automatic detection', () => {
    writeVoiceLanguage('ta');
    writeVoiceLanguage('');
    expect(readVoiceLanguage()).toBe('');
  });
});
