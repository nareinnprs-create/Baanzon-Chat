/**
 * Image generation via Cloudflare Workers AI. Tier-based models + daily caps:
 * Free 3/day (flux-1-schnell), Lite 10/day (SDXL-lightning), Pro 50/day (flux-2-klein),
 * Enterprise 200/day (flux-2-dev). Requires CF_ACCOUNT_ID + CF_API_TOKEN in .env.
 */
const express = require('express');
const mongoose = require('mongoose');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');

const router = express.Router();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const hits = new Map(); // userId -> [timestamps] (burst guard)
const DAILY = {
  free: { model: '@cf/black-forest-labs/flux-1-schnell', cap: 5 },
  lite: { model: '@cf/bytedance/stable-diffusion-xl-lightning', cap: 15 },
  pro: { model: '@cf/black-forest-labs/flux-2-klein-9b', cap: 75 },
  enterprise: { model: '@cf/black-forest-labs/flux-2-dev', cap: 300 },
};

/** Day boundary for image caps: midnight IST, matching usage caps. */
const imgDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

function limited(userId, cap) {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const key = `${userId}:${day}`;
  const used = (hits.get(key) || 0);
  if (used >= cap) return true;
  hits.set(key, used + 1);
  return false;
}

function imageType(buffer) {
  if (buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', extension: 'png' };
  }
  return { mime: 'application/octet-stream', extension: 'bin' };
}

async function userTier(userId) {
  const tier = await mongoose.connection.db.collection('users').findOne(
    { _id: new mongoose.Types.ObjectId(String(userId)) },
    { projection: { subscriptionTier: 1 } },
  );
  return String(tier?.subscriptionTier || 'free').toLowerCase();
}

router.post('/', requireJwtAuth, async (req, res) => {
  const prompt = String(req.body?.prompt || '').slice(0, 2000).trim();
  if (!prompt) {
    return res.status(400).json({ message: 'prompt is required' });
  }
  const tier = await userTier(req.user.id);
  const { model, cap } = DAILY[tier] || DAILY.free;
  if (limited(`${req.user.id}`, MAX_PER_WINDOW)) {
    return res.status(429).json({ message: 'Too many images this minute — try again shortly.' });
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const usedToday = await mongoose.connection.db.collection('usage_counters').findOne({ key: `img:${req.user.id}:${today}` });
  if ((usedToday?.count || 0) >= cap) {
    return res.status(402).json({ message: `Daily image limit reached (${cap}/day on your plan) — resets tonight.` });
  }
  await mongoose.connection.db.collection('usage_counters').updateOne(
    { key: `img:${req.user.id}:${today}` },
    { $setOnInsert: { userId: req.user.id, date: today, kind: 'image' }, $inc: { count: 1 } },
    { upsert: true },
  );
  const account = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  if (!account || !token) {
    return res.status(501).json({ message: 'Image generation is not configured on this deployment.' });
  }
  try {
    const isFlux2 = model.includes('flux-2');
    const runUrl = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`;
    let r;
    if (isFlux2) {
      // flux-2 family requires multipart/form-data input
      const fd = new FormData();
      fd.append('prompt', prompt);
      r = await fetch(runUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      if (!r.ok) {
        const detail = (await r.text()).slice(0, 300);
        return res.status(502).json({ message: 'Image generation failed', detail });
      }
      const j = await r.json();
      const b64 = j.result && (j.result.image || j.result.content);
      if (!b64) return res.status(502).json({ message: 'Image generation returned no image' });
       const buf = Buffer.from(String(b64), 'base64');
       const type = imageType(buf);
       res.setHeader('Content-Type', type.mime);
       res.setHeader('Content-Disposition', `inline; filename="baanzon-image.${type.extension}"`);
      return res.send(buf);
    }
    r = await fetch(runUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      return res.status(502).json({ message: 'Image generation failed', detail });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const type = imageType(buf);
    res.setHeader('Content-Type', type.mime);
    res.setHeader('Content-Disposition', `inline; filename="baanzon-image.${type.extension}"`);
    return res.send(buf);
  } catch (err) {
    return res.status(502).json({ message: 'Image generation failed', detail: String(err.message).slice(0, 200) });
  }
});

module.exports = router;
