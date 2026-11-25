import {
  isLikelyHallucination,
  normalizeVoiceLang,
  resolveVoiceLang,
  scriptLang,
} from './transcript';

describe('isLikelyHallucination', () => {
  it.each([
    'Продолжение следует...',
    'продолжение следует',
    'Субтитры сделал DimaTorzok',
    'Редактор субтитров А.Синецкая',
    'Thank you for watching!',
    'Subtitles by the Amara.org community',
  ])('drops the Whisper artifact %s', (text) => {
    expect(isLikelyHallucination(text)).toBe(true);
  });

  it('keeps real speech', () => {
    expect(isLikelyHallucination('வணக்கம், நான் தியா')).toBe(false);
    expect(isLikelyHallucination('hello diya')).toBe(false);
    expect(isLikelyHallucination('')).toBe(false);
  });
});

describe('scriptLang', () => {
  it.each([
    ['नमस्ते', 'hi'],
    ['வணக்கம்', 'ta'],
    ['నమస్తే', 'te'],
    ['ನಮಸ್ಕಾರ', 'kn'],
    ['നമസ്കാരം', 'ml'],
    ['নমস্কার', 'bn'],
    ['નમસ્તે', 'gu'],
    ['ਸਤ ਸ੍ਰੀ ਅਕਾਲ', 'pa'],
    ['ନମସ୍କାର', 'or'],
    ['hello', 'en'],
  ])('reads %s as %s', (text, lang) => {
    expect(scriptLang(text)).toBe(lang);
  });

  it('returns null for scripts the voice stack cannot speak', () => {
    expect(scriptLang('Продолжение следует')).toBeNull();
    expect(scriptLang('مرحبا')).toBeNull();
    expect(scriptLang('12345')).toBeNull();
  });
});

describe('normalizeVoiceLang', () => {
  it('accepts supported codes and rejects the rest', () => {
    expect(normalizeVoiceLang('ta')).toBe('ta');
    expect(normalizeVoiceLang('TA-IN')).toBe('ta');
    expect(normalizeVoiceLang('mai')).toBe('mai');
    expect(normalizeVoiceLang('mai-IN')).toBe('mai');
    expect(normalizeVoiceLang('ru')).toBeNull();
    expect(normalizeVoiceLang(null)).toBeNull();
  });
});

describe('resolveVoiceLang', () => {
  it('uses the text script when the report is a different family', () => {
    // Whisper reported Russian for Tamil audio.
    expect(resolveVoiceLang('ru', 'வணக்கம்')).toBe('ta');
    // English session, Tamil reply.
    expect(resolveVoiceLang('en', 'வணக்கம்')).toBe('ta');
    // Reported Hindi, Telugu script.
    expect(resolveVoiceLang('hi', 'నమస్తే')).toBe('te');
  });

  it('keeps the report inside one family (Marathi vs Hindi)', () => {
    expect(resolveVoiceLang('mr', 'नमस्कार')).toBe('mr');
    expect(resolveVoiceLang('hi', 'नमस्कार')).toBe('hi');
  });

  it('refuses a script it cannot voice', () => {
    expect(resolveVoiceLang('ru', 'Продолжение следует')).toBeNull();
    expect(resolveVoiceLang('ur', 'مرحبا')).toBe('ur');
    // Sindhi/Kashmiri share the script and have no voice yet.
    expect(resolveVoiceLang('sd', 'سلام')).toBeNull();
    // A Russian reply in an English session must not be read by the English
    // voice either.
    expect(resolveVoiceLang('en', 'Продолжение следует')).toBeNull();
    expect(resolveVoiceLang('en', 'Продолжение follows')).toBeNull();
  });

  it('speaks Urdu only when it is pinned', () => {
    expect(resolveVoiceLang('ur', 'سلام، میں دیا ہوں')).toBe('ur');
    expect(resolveVoiceLang(undefined, 'سلام، میں دیا ہوں')).toBeNull();
    expect(resolveVoiceLang('ur', 'hello')).toBe('en');
  });

  it('keeps Maithili inside Devanagari', () => {
    expect(resolveVoiceLang('mai', 'नमस्कार, हम दिया छी')).toBe('mai');
  });

  it('falls back to the report for text without a script', () => {
    expect(resolveVoiceLang('ta', '123')).toBe('ta');
  });
});
