const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

const FLAGS_WINDOW_MS = parseInt(process.env.FLAGS_WINDOW_MS) || 60 * 1000; // 1 minute
const FLAGS_MAX = parseInt(process.env.FLAGS_MAX) || 60; // 60 flag requests per user per minute

const flagsLimiter = rateLimit({
  windowMs: FLAGS_WINDOW_MS,
  max: FLAGS_MAX,
  handler: (_req, res) => {
    res.status(429).json({ message: 'Too many feature flag requests. Try again later' });
  },
  keyGenerator: (req) => req.user?.id,
  store: limiterCache('flags_limiter'),
});

module.exports = { flagsLimiter };
