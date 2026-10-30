const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

const BILLING_WINDOW_MS = parseInt(process.env.BILLING_WINDOW_MS) || 60 * 1000; // 1 minute
const BILLING_MAX = parseInt(process.env.BILLING_MAX) || 60; // 60 billing requests per user per minute

const billingLimiter = rateLimit({
  windowMs: BILLING_WINDOW_MS,
  max: BILLING_MAX,
  handler: (_req, res) => {
    res.status(429).json({ message: 'Too many billing requests. Try again later' });
  },
  keyGenerator: (req) => req.user?.id,
  store: limiterCache('billing_limiter'),
});

module.exports = { billingLimiter };
