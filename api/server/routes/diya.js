const express = require('express');
const { logger } = require('@librechat/data-schemas');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { projectsLimiter } = require('~/server/middleware/limiters');

const router = express.Router();

const UNAVAILABLE = 'diya_unavailable';
const UPSTREAM = 'diya_upstream';

const SYSTEM_PROMPT = [
  'You are Diya Orb, a warm, quick, helpful voice assistant.',
  'Reply in natural spoken language: short sentences, plain words, contractions.',
  'No markdown, no lists, no code, no emoji, no stage directions — the reply is read aloud.',
  'Keep replies under 120 words unless the user asks for more. Do not mention model names.',
].join(' ');

/**
 * One voice turn for Diya Orb: speech-to-text arrives as `text`, the reply
 * text goes back to be spoken in the browser. Stateless on purpose — the
 * client echoes the recent turns back in `history`, so there is no session
 * store and horizontal scaling needs nothing. The model identity stays
 * server-side and never reaches the response.
 */
router.post('/turn', requireJwtAuth, projectsLimiter, async (req, res) => {
  const settings = req.config?.config?.diya;
  if (settings && settings.enabled === false) {
    return res.status(503).json({ error: UNAVAILABLE });
  }
  const { text, history } = req.body ?? {};
  if (typeof text !== 'string' || text.trim() === '' || text.length > 4000) {
    return res.status(400).json({ error: 'text is required (1..4000 chars)' });
  }
  if (history != null && (!Array.isArray(history) || history.length > 16)) {
    return res.status(400).json({ error: 'history must be an array of at most 16 turns' });
  }
  for (const turn of history ?? []) {
    if (
      !turn ||
      (turn.role !== 'user' && turn.role !== 'assistant') ||
      typeof turn.content !== 'string' ||
      turn.content.length > 4000
    ) {
      return res.status(400).json({ error: 'invalid history turn' });
    }
  }

  const base = process.env.OPRAIZ_BASEURL;
  const key = process.env.OPRAIZ_API_KEY;
  if (!base || !key) {
    return res.status(503).json({ error: UNAVAILABLE });
  }
  const model =
    process.env.VOICE_MODEL ||
    process.env.DEEP_RESEARCH_MODEL ||
    '@cf/meta/llama-3.1-8b-instruct-fp8';

  try {
    const upstream = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...(history ?? []).slice(-12).map((turn) => ({ role: turn.role, content: turn.content })),
          { role: 'user', content: text.trim() },
        ],
      }),
    });
    if (!upstream.ok) {
      logger.warn('[diya] upstream rejected the turn', { status: upstream.status });
      return res.status(502).json({ error: UPSTREAM });
    }
    const data = await upstream.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return res.status(502).json({ error: UPSTREAM });
    }
    return res.json({ reply });
  } catch (err) {
    logger.error('[diya] turn failed', err);
    return res.status(502).json({ error: UPSTREAM });
  }
});

module.exports = router;
