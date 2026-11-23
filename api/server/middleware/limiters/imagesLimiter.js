const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

/**
 * Image generation is the most expensive endpoint in the product (paid image
 * models per call). Auth alone let any signed-in user loop it; this caps the
 * spend per user without touching normal use.
 */
const IMAGES_WINDOW_MS = parseInt(process.env.IMAGES_WINDOW_MS) || 60 * 1000;
const IMAGES_MAX = parseInt(process.env.IMAGES_MAX) || 10;

const imagesLimiter = rateLimit({
  windowMs: IMAGES_WINDOW_MS,
  max: IMAGES_MAX,
  handler: (_req, res) => {
    res.status(429).json({ message: 'Too many image requests. Try again shortly' });
  },
  keyGenerator: (req) => req.user?.id,
  store: limiterCache('images_limiter'),
});

module.exports = { imagesLimiter };
