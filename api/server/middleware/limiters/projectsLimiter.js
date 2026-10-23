const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

const PROJECTS_WINDOW_MS = parseInt(process.env.PROJECTS_WINDOW_MS) || 60 * 1000; // 1 minute
const PROJECTS_MAX = parseInt(process.env.PROJECTS_MAX) || 60; // 60 project requests per user per minute

const projectsLimiter = rateLimit({
  windowMs: PROJECTS_WINDOW_MS,
  max: PROJECTS_MAX,
  handler: (_req, res) => {
    res.status(429).json({ message: 'Too many project requests. Try again later' });
  },
  keyGenerator: (req) => req.user?.id,
  store: limiterCache('projects_limiter'),
});

module.exports = { projectsLimiter };
