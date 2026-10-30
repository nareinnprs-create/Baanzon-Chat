const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

const REWRITE_WINDOW_MS = parseInt(process.env.REWRITE_WINDOW_MS) || 60 * 1000; // 1 minute
const REWRITE_MAX = parseInt(process.env.REWRITE_MAX) || 30; // 30 rewrite requests per user per minute

const rewriteLimiter = rateLimit({
  windowMs: REWRITE_WINDOW_MS,
  max: REWRITE_MAX,
  handler: (_req, res) => {
    res.status(429).json({ message: 'Too many rewrite requests. Try again later' });
  },
  keyGenerator: (req) => req.user?.id,
  store: limiterCache('rewrite_limiter'),
});

module.exports = { rewriteLimiter };
