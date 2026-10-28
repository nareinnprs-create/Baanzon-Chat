const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

const EVALS_WINDOW_MS = parseInt(process.env.EVALS_WINDOW_MS) || 60 * 1000; // 1 minute
const EVALS_MAX = parseInt(process.env.EVALS_MAX) || 60; // 60 eval requests per user per minute

const evalsLimiter = rateLimit({
  windowMs: EVALS_WINDOW_MS,
  max: EVALS_MAX,
  handler: (_req, res) => {
    res.status(429).json({ message: 'Too many eval requests. Try again later' });
  },
  keyGenerator: (req) => req.user?.id,
  store: limiterCache('evals_limiter'),
});

module.exports = { evalsLimiter };
