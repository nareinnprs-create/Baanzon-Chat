/**
 * Image generation via Cloudflare Workers AI. Model is picked per prompt by
 * pickImageModel (packages/api imageModelRouter) from the approved catalog;
 * tiers gate daily caps: Free 5/day, Lite 15/day, Pro 75/day, Enterprise
 * 300/day. Requires CF_ACCOUNT_ID + CF_API_TOKEN in .env.
 */
const express = require('express');
const mongoose = require('mongoose');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { imagesLimiter } = require('~/server/middleware/limiters');
const { pickImageChain } = require('@librechat/api');

/** Optional sharp import: the text overlay degrades to the plain image when
 *  the module or the system fonts are missing. */
let sharp = null;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

const router = express.Router();
const MAX_PER_WINDOW = 5;
const hits = new Map(); // userId -> [timestamps] (burst guard)
const DAILY = {
  free: { cap: 5 },
  lite: { cap: 15 },
  pro: { cap: 75 },
  enterprise: { cap: 300 },
};

function limited(userId, cap) {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const key = `${userId}:${day}`;
  const used = hits.get(key) || 0;
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

function decodeImage(value) {
  const encoded = String(value || '').replace(/^data:image\/[^;]+;base64,/, '');
  return Buffer.from(encoded, 'base64');
}

function sendImage(res, buffer) {
  const type = imageType(buffer);
  res.setHeader('Content-Type', type.mime);
  res.setHeader('Content-Disposition', `inline; filename="baanzon-image.${type.extension}"`);
  return res.send(buffer);
}

/** Quoted strings in the prompt ("..." / “...” / «...») are the text the user
 *  wants IN the image. Diffusion models render Latin text passably but Indic
 *  scripts as garbage, so we composite it ourselves with real fonts. */
const QUOTED_RE = /["“«']([^"”»']{1,60})["”»']/g;
const COMPOSITE_TRIGGER_RE =
  /\b(add|with|saying|write|text|caption|include|put|तस्वीर|लिखो|लिखें|दिखाओ|text|எழுத|రాయండి|লেখো)\b/i;

/** Extracts the overlay texts from a prompt: quoted fragments only - never
 *  the whole prompt (that would caption the image with instructions). */
function extractOverlayText(prompt) {
  if (!COMPOSITE_TRIGGER_RE.test(prompt)) {
    return [];
  }
  const texts = [];
  for (const match of prompt.matchAll(QUOTED_RE)) {
    const piece = match[1].trim();
    if (piece) {
      texts.push(piece);
    }
  }
  return texts.slice(0, 2);
}

/** Composites the overlay texts onto the image (centered band at the bottom,
 *  auto-wrapped, white with a dark scrim) via an SVG overlay. Uses Noto fonts
 *  (pod-level install) so Indic scripts render correctly. Degrades to the
 *  plain image on any failure - generation itself never breaks. */
async function compositeText(buffer, texts) {
  if (!sharp || texts.length === 0) {
    return buffer;
  }
  try {
    const image = sharp(buffer);
    const meta = await image.metadata();
    const width = meta.width || 1024;
    const height = meta.height || 1024;
    const fontSize = Math.max(28, Math.round(width / 18));
    const lineHeight = Math.round(fontSize * 1.3);
    // Wrap each text to the image width (roughly fontSize chars per line).
    const lines = [];
    for (const text of texts) {
      let current = '';
      for (const word of text.split(/\s+/)) {
        if ((current + ' ' + word).trim().length > Math.floor(width / (fontSize * 0.62))) {
          if (current) lines.push(current.trim());
          current = word;
        } else {
          current = `${current} ${word}`;
        }
      }
      if (current.trim()) lines.push(current.trim());
    }
    if (lines.length === 0) {
      return buffer;
    }
    const bandHeight = lines.length * lineHeight + Math.round(fontSize);
    const y0 = height - bandHeight - Math.round(fontSize * 0.6);
    const tspans = lines
      .map(
        (line, i) =>
          `<text x="${Math.round(width / 2)}" y="${y0 + Math.round(fontSize * 1.1) + i * lineHeight}" text-anchor="middle" font-family="Noto Sans, Noto Sans Devanagari, Noto Sans Tamil, Noto Sans Telugu, sans-serif" font-size="${fontSize}" font-weight="600" fill="#ffffff" stroke="#000000" stroke-width="${Math.max(2, fontSize / 16)}" paint-order="stroke">${line
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')}</text>`,
      )
      .join('');
    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="${y0}" width="${width}" height="${bandHeight}" fill="#000000" opacity="0.45"/>${tspans}</svg>`;
    const composited = await image
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .png()
      .toBuffer();
    return composited;
  } catch {
    return buffer;
  }
}

async function userTier(userId) {
  const tier = await mongoose.connection.db
    .collection('users')
    .findOne(
      { _id: new mongoose.Types.ObjectId(String(userId)) },
      { projection: { subscriptionTier: 1 } },
    );
  return String(tier?.subscriptionTier || 'free').toLowerCase();
}

router.post('/', requireJwtAuth, imagesLimiter, async (req, res) => {
  const prompt = String(req.body?.prompt || '')
    .slice(0, 2000)
    .trim();
  if (!prompt) {
    return res.status(400).json({ message: 'prompt is required' });
  }
  const tier = await userTier(req.user.id);
  const { cap } = DAILY[tier] || DAILY.free;
  // Equally-powerful failover chain: try the pick first, hop on failure.
  const chain = pickImageChain(prompt);
  if (chain.length === 0) {
    return res.status(400).json({ message: 'No image model available for this prompt.' });
  }
  if (limited(`${req.user.id}`, MAX_PER_WINDOW)) {
    return res.status(429).json({ message: 'Too many images this minute — try again shortly.' });
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const usedToday = await mongoose.connection.db
    .collection('usage_counters')
    .findOne({ key: `img:${req.user.id}:${today}` });
  if ((usedToday?.count || 0) >= cap) {
    return res
      .status(402)
      .json({ message: `Daily image limit reached (${cap}/day on your plan) — resets tonight.` });
  }
  await mongoose.connection.db
    .collection('usage_counters')
    .updateOne(
      { key: `img:${req.user.id}:${today}` },
      { $setOnInsert: { userId: req.user.id, date: today, kind: 'image' }, $inc: { count: 1 } },
      { upsert: true },
    );
  try {
    const account = process.env.CF_ACCOUNT_ID;
    const token = process.env.CF_API_TOKEN;
    if (!account || !token) {
      return res
        .status(501)
        .json({ message: 'Image generation is not configured on this deployment.' });
    }
    const runBase = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run`;
    let lastDetail = '';
    for (const model of chain) {
      const runUrl = `${runBase}/${model}`;
      const isFlux2 = model.includes('flux-2');
      let r;
      if (isFlux2) {
        // flux-2 family requires multipart/form-data input
        const fd = new FormData();
        fd.append('prompt', prompt);
        r = await fetch(runUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
      } else {
        r = await fetch(runUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });
      }
      if (!r.ok) {
        lastDetail = (await r.text()).slice(0, 300);
        console.warn(`[images] ${model} failed (${r.status}), trying next in chain`);
        continue;
      }
      const contentType = r.headers.get('content-type') || '';
      let b64;
      if (isFlux2 || contentType.includes('application/json')) {
        const j = await r.json();
        b64 = j.result && (j.result.image || j.result.content);
      } else {
        b64 = Buffer.from(await r.arrayBuffer()).toString('base64');
      }
      if (!b64) {
        lastDetail = 'generation returned no image';
        continue;
      }
      const rendered = decodeImage(b64);
      const overlayTexts = extractOverlayText(prompt);
      if (overlayTexts.length > 0) {
        return sendImage(res, await compositeText(rendered, overlayTexts));
      }
      return sendImage(res, rendered);
    }
    return res.status(502).json({ message: 'Image generation failed', detail: lastDetail });
  } catch (err) {
    return res
      .status(502)
      .json({ message: 'Image generation failed', detail: String(err.message).slice(0, 200) });
  }
});

module.exports = router;
