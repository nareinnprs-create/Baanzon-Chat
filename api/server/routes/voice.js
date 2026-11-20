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
const { projectsLimiter } = require('~/server/middleware/limiters');
const {
  buildVoiceConfig,
  voiceClientConfig,
  remainingSeconds,
  normalizeTier,
} = require('@librechat/api');

const router = express.Router();

const SIDECAR_URL = process.env.VOICE_TTS_URL || 'http://127.0.0.1:8471';
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

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

async function cfRun(model, body) {
  const account = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  if (!account || !token) {
    throw new Error('Cloudflare is not configured');
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new Error(`CF ${model} ${response.status}`);
  }
  return response;
}

async function sidecarTts(text, lang) {
  const response = await fetch(`${SIDECAR_URL}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, lang }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`sidecar ${response.status}`);
  }
  return { buffer: Buffer.from(await response.arrayBuffer()), mime: 'audio/wav' };
}

/** Ordered providers per language: best human voice first, sidecar as the
 *  always-available fallback (and primary for Indic). */
async function synthesize(text, lang) {
  const errors = [];
  const attempts = [];
  if (lang === 'en') {
    attempts.push([
      'aura-1',
      async () => {
        const response = await cfRun('@cf/deepgram/aura-1', { text });
        return { buffer: Buffer.from(await response.arrayBuffer()), mime: 'audio/mpeg' };
      },
    ]);
  }
  if (lang === 'es') {
    attempts.push([
      'aura-2-es',
      async () => {
        const response = await cfRun('@cf/deepgram/aura-2-es', { text });
        return { buffer: Buffer.from(await response.arrayBuffer()), mime: 'audio/mpeg' };
      },
    ]);
  }
  attempts.push([`sidecar:${lang}`, () => sidecarTts(text, lang)]);

  for (const [name, attempt] of attempts) {
    try {
      const audio = await attempt();
      if (audio.buffer.length > 0) {
        return { ...audio, engine: name };
      }
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
      logger.warn(`[voice] tts ${name} failed: ${error.message}`);
    }
  }
  const error = new Error('no TTS provider could synthesize this language');
  error.details = errors.join('; ');
  throw error;
}

/** Speech in: base64 audio -> text (+ language when the engine reports it). */
router.post('/stt', requireJwtAuth, projectsLimiter, async (req, res) => {
  const { audio, mime } = req.body ?? {};
  if (typeof audio !== 'string' || audio.length === 0) {
    return res.status(400).json({ error: 'audio is required (base64)' });
  }
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
    const response = await cfRun('@cf/openai/whisper-large-v3-turbo', {
      audio: Array.from(bytes),
      ...(typeof mime === 'string' && mime ? { mime_type: mime } : {}),
    });
    const data = await response.json();
    const text = typeof data?.result?.text === 'string' ? data.result.text.trim() : '';
    if (!text) {
      return res.status(422).json({ error: 'no speech detected' });
    }
    const language = typeof data?.result?.language === 'string' ? data.result.language : null;
    return res.json({ text, language });
  } catch (error) {
    logger.warn(`[voice] stt failed: ${error.message}`);
    return res.status(502).json({ error: 'transcription failed' });
  }
});

/** Speech out: text -> audio (one fixed female voice per language). */
router.post('/tts', requireJwtAuth, projectsLimiter, async (req, res) => {
  const text = String(req.body?.text || '')
    .slice(0, 1200)
    .trim();
  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }
  const lang = String(req.body?.lang || '').toLowerCase().slice(0, 2) || detectLang(text);
  try {
    const audio = await synthesize(text, lang);
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
