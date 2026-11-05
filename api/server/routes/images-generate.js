/**
 * Image generation via Cloudflare Workers AI (Stable Diffusion XL).
 * Requires CF_ACCOUNT_ID + CF_API_TOKEN in .env. Auth + basic per-user limiter.
 */
const express = require('express');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');

const router = express.Router();
const MODEL = '@cf/stable-diffusion-xl-base-1.0';
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const hits = new Map(); // userId -> [timestamps]

function limited(userId) {
  const now = Date.now();
  const arr = (hits.get(userId) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) {
    hits.set(userId, arr);
    return true;
  }
  arr.push(now);
  hits.set(userId, arr);
  return false;
}

router.post('/', requireJwtAuth, async (req, res) => {
  const prompt = String(req.body?.prompt || '').slice(0, 2000).trim();
  if (!prompt) {
    return res.status(400).json({ message: 'prompt is required' });
  }
  if (limited(req.user.id)) {
    return res.status(429).json({ message: 'Too many images this minute — try again shortly.' });
  }
  const account = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  if (!account || !token) {
    return res.status(501).json({ message: 'Image generation is not configured on this deployment.' });
  }
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${MODEL}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      return res.status(502).json({ message: 'Image generation failed', detail });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'inline; filename="baanzon-image.png"');
    return res.send(buf);
  } catch (err) {
    return res.status(502).json({ message: 'Image generation failed', detail: String(err.message).slice(0, 200) });
  }
});

module.exports = router;
