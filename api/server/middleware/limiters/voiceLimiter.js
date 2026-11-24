const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

/**
 * Diya voice budget, per user.
 *
 * A spoken reply is synthesized sentence by sentence, so one answer costs
 * several requests; the ceiling is generous on purpose. It is its own bucket so
 * a conversation cannot starve project browsing (and vice versa), which is what
 * happened when both shared `projectsLimiter`.
 */
const VOICE_WINDOW_MS = parseInt(process.env.VOICE_WINDOW_MS) || 60 * 1000;
const VOICE_MAX = parseInt(process.env.VOICE_MAX) || 120;

const voiceLimiter = rateLimit({
  windowMs: VOICE_WINDOW_MS,
  max: VOICE_MAX,
  handler: (_req, res) => {
    res.status(429).json({ message: 'Too many voice requests. Try again shortly' });
  },
  keyGenerator: (req) => req.user?.id,
  store: limiterCache('voice_limiter'),
});

module.exports = { voiceLimiter };
