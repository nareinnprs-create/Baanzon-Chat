/**
 * Voice Mode config endpoint. Returns the client-facing payload: generic
 * voice labels, default mode, and the user's remaining voice seconds today.
 * Provider and model identities never leave the server.
 */
const express = require('express');
const mongoose = require('mongoose');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const configMiddleware = require('~/server/middleware/config/app');
const {
  buildVoiceConfig,
  voiceClientConfig,
  remainingSeconds,
  normalizeTier,
} = require('@librechat/api');

const router = express.Router();

async function userTier(userId) {
  const user = await mongoose.connection.db
    .collection('users')
    .findOne(
      { _id: new mongoose.Types.ObjectId(String(userId)) },
      { projection: { subscriptionTier: 1 } },
    );
  return String(user?.subscriptionTier || 'free').toLowerCase();
}

router.get('/config', requireJwtAuth, configMiddleware, async (req, res) => {
  try {
    const config = buildVoiceConfig(req?.config?.voice ?? null);
    const tier = normalizeTier(await userTier(req.user.id));
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const counter = await mongoose.connection.db
      .collection('usage_counters')
      .findOne({ key: `voice:${req.user.id}:${today}` });
    const remaining = remainingSeconds(tier, counter?.count || 0, config.tierMinutes);
    return res.json(voiceClientConfig(config, remaining));
  } catch {
    // Quota lookups fail open: a broken counter must not break voice setup.
    const fallback = buildVoiceConfig(req?.config?.voice ?? null);
    return res.json(voiceClientConfig(fallback, remainingSeconds('free', 0, fallback.tierMinutes)));
  }
});

module.exports = router;
