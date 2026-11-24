const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

/**
 * Speech-out budget, separate from `voiceLimiter`.
 *
 * A reply is synthesized one sentence per request, so a single answer can be a
 * dozen calls; sharing the STT/turn bucket made long replies hit 429 halfway
 * through. This ceiling is high enough for normal conversation and still caps
 * a runaway loop.
 */
const TTS_WINDOW_MS = parseInt(process.env.VOICE_TTS_WINDOW_MS) || 60 * 1000;
const TTS_MAX = parseInt(process.env.VOICE_TTS_MAX) || 600;

const ttsLimiter = rateLimit({
  windowMs: TTS_WINDOW_MS,
  max: TTS_MAX,
  handler: (_req, res) => {
    res.status(429).json({ message: 'Too many speech requests. Try again shortly' });
  },
  keyGenerator: (req) => req.user?.id,
  store: limiterCache('voice_tts_limiter'),
});

module.exports = { ttsLimiter };
