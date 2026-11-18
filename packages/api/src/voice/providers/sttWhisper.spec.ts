import { detectLanguage, encodeWav, parseWhisperResponse } from './sttWhisper';

describe('sttWhisper helpers', () => {
  it('encodeWav writes a 44-byte PCM16 mono header', () => {
    const pcm = Buffer.alloc(3200); // 0.1s at 16 kHz
    const wav = encodeWav(pcm, 16000);
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.subarray(8, 12).toString()).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.length).toBe(pcm.length + 44);
  });

  it('parseWhisperResponse extracts text and language', () => {
    expect(
      parseWhisperResponse({
        result: { text: '  નમસ્તે  ', transcription_info: { language: 'gu', language_probability: 0.9 } },
      }),
    ).toEqual({ text: 'નમસ્તે', language: 'gu' });
  });

  it('parseWhisperResponse returns null without usable text', () => {
    expect(parseWhisperResponse({ result: { text: '' } })).toBeNull();
    expect(parseWhisperResponse(null)).toBeNull();
    expect(parseWhisperResponse({ result: {} })).toBeNull();
  });

  it('parseWhisperResponse defaults the language to en', () => {
    expect(parseWhisperResponse({ result: { text: 'hello' } })).toEqual({ text: 'hello', language: 'en' });
  });

  it.each([
    ['नमस्ते, कैसे हो?', 'hi'],
    ['તમે કેમ છો?', 'gu'],
    ['வணக்கம்', 'ta'],
    ['hello there, how are you?', 'en'],
    ['ok wait 2 minutes', 'en'],
  ])('detectLanguage(%j) -> %s', (text, expected) => {
    expect(detectLanguage(text)).toBe(expected);
  });
});
