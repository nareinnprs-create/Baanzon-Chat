const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

const TRUST_WINDOW_MS = parseInt(process.env.TRUST_WINDOW_MS) || 60 * 1000; // 1 minute
const TRUST_MAX = parseInt(process.env.TRUST_MAX) || 60; // 60 trust evaluations per user per minute

const trustLimiter = rateLimit({
  windowMs: TRUST_WINDOW_MS,
  max: TRUST_MAX,
  handler: (_req, res) => {
    res.status(429).json({ message: 'Too many trust requests. Try again later' });
  },
  keyGenerator: (req) => req.user?.id,
  store: limiterCache('trust_limiter'),
});

module.exports = { trustLimiter };
