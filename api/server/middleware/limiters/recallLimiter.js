const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

const RECALL_WINDOW_MS = parseInt(process.env.RECALL_WINDOW_MS) || 60 * 1000; // 1 minute
const RECALL_MAX = parseInt(process.env.RECALL_MAX) || 30; // 30 recall requests per user per minute

const recallLimiter = rateLimit({
  windowMs: RECALL_WINDOW_MS,
  max: RECALL_MAX,
  handler: (_req, res) => {
    res.status(429).json({ message: 'Too many recall requests. Try again later' });
  },
  keyGenerator: (req) => req.user?.id,
  store: limiterCache('recall_limiter'),
});

module.exports = { recallLimiter };
