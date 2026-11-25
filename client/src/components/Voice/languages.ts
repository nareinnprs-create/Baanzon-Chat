/**
 * Languages Diya can listen to and speak, labelled in their own script.
 *
 * Automatic detection is the default, but Whisper's auto-detect confuses
 * Indic languages on short clips (Telugu heard as Tamil, Marathi as Hindi), and
 * no server-side rule can recover the real language from a transcript that was
 * written in the wrong script. Choosing one pins both the STT hint and the
 * voice, so the user is never stuck with the wrong language.
 */
export const VOICE_LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'bn', label: 'বাংলা' },
  { code: 'gu', label: 'ગુજરાતી' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
  { code: 'ml', label: 'മലയാളം' },
  { code: 'mr', label: 'मराठी' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ' },
  { code: 'or', label: 'ଓଡ଼ିଆ' },
  { code: 'as', label: 'অসমীয়া' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
];

const STORAGE_KEY = 'baanzon-voice-language';

/** The saved choice, or `''` for automatic detection. */
export function readVoiceLanguage(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) ?? '';
    return VOICE_LANGUAGES.some((entry) => entry.code === saved) ? saved : '';
  } catch {
    return '';
  }
}

/** Persists the choice; `''` restores automatic detection. */
export function writeVoiceLanguage(code: string): void {
  try {
    if (code) {
      localStorage.setItem(STORAGE_KEY, code);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* A blocked storage just means the choice lasts this session. */
  }
}
