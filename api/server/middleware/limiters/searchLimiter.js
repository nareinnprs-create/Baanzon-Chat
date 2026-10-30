const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

const SEARCH_WINDOW_MS = parseInt(process.env.SEARCH_WINDOW_MS) || 60 * 1000; // 1 minute
const SEARCH_MAX = parseInt(process.env.SEARCH_MAX) || 60; // 60 cross-entity search requests per user per minute

const searchLimiter = rateLimit({
  windowMs: SEARCH_WINDOW_MS,
  max: SEARCH_MAX,
  handler: (_req, res) => {
    res.status(429).json({ message: 'Too many cross-entity search requests. Try again later' });
  },
  keyGenerator: (req) => req.user?.id,
  store: limiterCache('search_limiter'),
});

module.exports = { searchLimiter };
