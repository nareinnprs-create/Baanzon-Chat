import i18n from '~/locales/i18n';

/**
 * Languages Diya can listen to and speak, labelled in their own script.
 *
 * Automatic detection is the default for English, but Whisper's auto-detect
 * mislabels most Indic languages on short clips (measured: mean character
 * error 85% auto vs 40% with a hint, and Telugu came back as Tamil). A user
 * whose app is already in Tamil is almost certainly speaking Tamil, so the
 * app locale seeds the choice; the selector stays available and "Auto-detect"
 * is an explicit stored choice, never a fallback.
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
/** Explicit "Auto-detect" so the app-locale default can be overridden. */
const AUTO = 'auto';

function isVoiceLanguage(code: string): boolean {
  return VOICE_LANGUAGES.some((entry) => entry.code === code);
}

/** The saved choice, the app locale for Indic users, or `''` for auto. */
export function readVoiceLanguage(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === AUTO) {
      return '';
    }
    if (saved && isVoiceLanguage(saved)) {
      return saved;
    }
  } catch {
    /* storage blocked: fall through to the locale */
  }
  const locale = String(i18n.language || '')
    .slice(0, 2)
    .toLowerCase();
  return locale !== 'en' && isVoiceLanguage(locale) ? locale : '';
}

/** Persists the choice; `''` stores an explicit automatic detection. */
export function writeVoiceLanguage(code: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, code || AUTO);
  } catch {
    /* A blocked storage just means the choice lasts this session. */
  }
}
