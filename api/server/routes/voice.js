/**
 * Voice Mode config endpoint + Diya audio endpoints.
 *
 * `GET  /config` - client-facing Voice Mode payload: generic voice labels,
 *                  default mode, and the user's remaining voice seconds today.
 *                  Provider and model identities never leave the server.
 * `POST /stt`    - speech in: Whisper large-v3-turbo on Workers AI (auto
 *                  language detection), base64 audio in, text out.
 * `POST /tts`    - speech out: one fixed female voice per language, served as
 *                  audio. en -> aura-1 (CF), es -> aura-2-es (CF), everything
 *                  else -> the local Kokoro/MMS sidecar. Device voices are
 *                  never involved, so browser locale/settings cannot change
 *                  what users hear.
 */
const express = require('express');
const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const configMiddleware = require('~/server/middleware/config/app');
const { voiceLimiter, ttsLimiter } = require('~/server/middleware/limiters');
const {
  buildVoiceConfig,
  voiceClientConfig,
  remainingSeconds,
  normalizeTier,
  isLikelyHallucination,
  normalizeVoiceLang,
  resolveVoiceLang,
} = require('@librechat/api');
const { cfRun, synthesize } = require('~/server/services/Voice/ttsLadder');

const router = express.Router();

// The global JSON parser stops at 3MB and base64 costs 4/3, so a 2MB clip is the
// most this route can actually receive. Keeping the check aligned means an
// oversized clip gets our JSON error instead of a body-parser 413.
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

const SCRIPT_LANG = [
  [/[\u0900-\u097F]/, 'hi'],
  [/[\u0980-\u09FF]/, 'bn'],
  [/[\u0A00-\u0A7F]/, 'pa'],
  [/[\u0A80-\u0AFF]/, 'gu'],
  [/[\u0B00-\u0B7F]/, 'or'],
  [/[\u0B80-\u0BFF]/, 'ta'],
  [/[\u0C00-\u0C7F]/, 'te'],
  [/[\u0C80-\u0CFF]/, 'kn'],
  [/[\u0D00-\u0D7F]/, 'ml'],
];

/** Detects the language of a reply by its script; Latin text stays English. */
function detectLang(text, fallback = 'en') {
  for (const [pattern, lang] of SCRIPT_LANG) {
    if (pattern.test(text)) {
      return lang;
    }
  }
  return fallback;
}

async function userTier(userId) {
  const user = await mongoose.connection.db
    .collection('users')
    .findOne(
      { _id: new mongoose.Types.ObjectId(String(userId)) },
      { projection: { subscriptionTier: 1 } },
    );
  return String(user?.subscriptionTier || 'free').toLowerCase();
}

/** The same Asia/Kolkata day bucket the WebSocket gateway meters against. */
function voiceDay() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function voiceCounters() {
  return mongoose.connection.db.collection('usage_counters');
}

/**
 * Seconds left on the caller's tier today.
 *
 * The orb used to be unmetered: `addSeconds` existed only in the WebSocket
 * gateway, which the orb never touches, so `/config` reported a number that
 * never moved. Both audio routes charge here now.
 */
async function voiceRemaining(userId) {
  const config = buildVoiceConfig(null);
  const tier = normalizeTier(await userTier(userId));
  const counter = await voiceCounters().findOne({ key: `voice:${userId}:${voiceDay()}` });
  return remainingSeconds(tier, counter?.count || 0, config.tierMinutes);
}

/** Wall-clock-ish charge; a failure must never break the reply. */
function chargeVoice(userId, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return;
  }
  voiceCounters()
    .updateOne(
      { key: `voice:${userId}:${voiceDay()}` },
      {
        $setOnInsert: { userId, date: voiceDay(), kind: 'voice' },
        $inc: { count: Math.round(seconds) },
      },
      { upsert: true },
    )
    .catch((error) => logger.warn(`[voice] metering write failed: ${error.message}`));
}

/** Rough speech duration of an opus clip (~32kbps) and of spoken text. */
function audioSeconds(bytes) {
  return Math.min(bytes / 4000, 300);
}
function speechSeconds(text) {
  return Math.min(text.length / 15, 120);
}

router.get('/config', requireJwtAuth, configMiddleware, async (req, res) => {
  try {
    const config = buildVoiceConfig(req?.config?.voice ?? null);
    const tier = normalizeTier(await userTier(req.user.id));
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const counter = await mongoose.connection.db
      .collection('usage_counters')
      .findOne({ key: `voice:${req.user.id}:${today}` });
    const remaining = remainingSeconds(tier, counter?.count || 0, config.tierMinutes);
    return res.json(voiceClientConfig(config, remaining));
  } catch {
    // Quota lookups fail open: a broken counter must not break voice setup.
    const fallback = buildVoiceConfig(req?.config?.voice ?? null);
    return res.json(voiceClientConfig(fallback, remainingSeconds('free', 0, fallback.tierMinutes)));
  }
});

/** Speech in: base64 audio -> text (+ language when the engine reports it). */
router.post('/stt', requireJwtAuth, voiceLimiter, async (req, res) => {
  const { audio, language: requestedLanguage } = req.body ?? {};
  if (typeof audio !== 'string' || audio.length === 0) {
    return res.status(400).json({ error: 'audio is required (base64)' });
  }
  // A user-pinned language is the reliable answer to Whisper's auto-detect,
  // which confuses Indic languages on short clips. Only languages the voice
  // stack speaks are accepted as a hint.
  const hint = normalizeVoiceLang(requestedLanguage);
  let bytes;
  try {
    bytes = Buffer.from(audio, 'base64');
  } catch {
    return res.status(400).json({ error: 'audio is not valid base64' });
  }
  if (bytes.length === 0 || bytes.length > MAX_AUDIO_BYTES) {
    return res.status(413).json({ error: 'audio size out of range' });
  }
  try {
    const remaining = await voiceRemaining(req.user.id);
    if (remaining <= 0) {
      return res.status(429).json({ error: 'voice_quota_exhausted' });
    }
  } catch {
    // A broken counter must not block speech in; metering still applies.
  }
  const startedAt = Date.now();
  try {
    // Whisper takes the container bytes as base64 and detects the format itself;
    // an array of ints is only for raw PCM and is rejected for compressed audio.
    const response = await cfRun('@cf/openai/whisper-large-v3-turbo', {
      audio,
      ...(hint ? { language: hint } : {}),
    });
    const data = await response.json();
    const text = typeof data?.result?.text === 'string' ? data.result.text.trim() : '';
    if (!text) {
      return res.status(422).json({ error: 'no speech detected' });
    }
    // Whisper emits canned phrases for silence and noise ("Продолжение
    // следует..." and friends). They used to become real user messages and
    // Russian replies, so they are dropped as if nothing was said.
    if (isLikelyHallucination(text)) {
      logger.warn('[voice] stt dropped a known Whisper hallucination');
      return res.status(422).json({ error: 'no speech detected' });
    }
    const reported = data?.result?.transcription_info?.language ?? data?.result?.language;
    // Never hand the client a language the voice stack cannot speak: a wrong
    // code made the reply come back in that language and the TTS fall back to
    // an English voice reading it.
    const language = resolveVoiceLang(reported, text);
    if (language == null) {
      logger.warn(`[voice] stt dropped an unsupported language: ${String(reported).slice(0, 12)}`);
      return res.status(422).json({ error: 'unsupported language' });
    }
    chargeVoice(req.user.id, audioSeconds(bytes.length));
    logger.debug(
      `[voice] stt ok lang=${language} reported=${reported || '?'} bytes=${bytes.length} ms=${
        Date.now() - startedAt
      }`,
    );
    return res.json({ text, language });
  } catch (error) {
    logger.warn(`[voice] stt failed: ${error.message}`);
    return res.status(502).json({ error: 'transcription failed' });
  }
});

/** Speech out: text -> audio (one fixed female voice per language). */
router.post('/tts', requireJwtAuth, ttsLimiter, async (req, res) => {
  const text = String(req.body?.text || '')
    .slice(0, 1200)
    .trim();
  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }
  // The reply text is the final authority on what voice to use: a Tamil reply
  // in an English session must not be read by the English voice, and text in a
  // script we cannot voice is refused rather than spoken as gibberish.
  const lang = resolveVoiceLang(req.body?.lang, text);
  if (lang == null) {
    logger.warn(
      `[voice] tts refused an unsupported language: ${String(req.body?.lang).slice(0, 12)}`,
    );
    return res.status(422).json({ error: 'unsupported language' });
  }
  try {
    const remaining = await voiceRemaining(req.user.id);
    if (remaining <= 0) {
      return res.status(429).json({ error: 'voice_quota_exhausted' });
    }
  } catch {
    // Fail open on a counter read error; the reply still gets spoken.
  }
  try {
    const audio = await synthesize(text, lang);
    chargeVoice(req.user.id, speechSeconds(text));
    res.setHeader('Content-Type', audio.mime);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Voice-Engine', audio.engine);
    return res.send(audio.buffer);
  } catch (error) {
    logger.warn(`[voice] tts failed for ${lang}: ${error.message} ${error.details || ''}`);
    return res.status(502).json({ error: 'speech synthesis failed', lang });
  }
});

module.exports = router;
module.exports.detectLang = detectLang;
