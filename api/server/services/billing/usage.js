/**
 * Per-user daily allowance enforcement. Never surfaces numbers to users:
 * cap-hit responses say "today's allowance" only. Packs (one-time Dodo
 * purchases) are consumed after the daily allowance. Fails open on internal
 * errors — never blocks chat because the counter tripped on our side.
 */
const mongoose = require('mongoose');

const TIER_LIMITS = { free: 15, lite: 33, pro: 110, enterprise: 200 };

const today = () => new Date().toISOString().slice(0, 10);

function counters() {
  return mongoose.connection.db.collection('usage_counters');
}

function users() {
  return mongoose.connection.db.collection('users');
}

async function getUserSlim(userId) {
  const user = await users().findOne(
    { _id: new mongoose.Types.ObjectId(String(userId)) },
    { projection: { subscriptionTier: 1, subscriptionStatus: 1, packCredits: 1 } },
  );
  return {
    tier: (user?.subscriptionTier || 'free').toLowerCase(),
    status: user?.subscriptionStatus || 'active',
    packCredits: user?.packCredits || 0,
  };
}

async function getCounter(userId) {
  const key = `${String(userId)}:${today()}`;
  const c = counters();
  await c.updateOne(
    { key },
    { $setOnInsert: { key, userId: String(userId), date: today(), count: 0, packsUsed: 0 } },
    { upsert: true },
  );
  return c.findOne({ key });
}

/** Express middleware factory for generation routes. */
const enforce = () => async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return next();
    const { tier, status, packCredits } = await getUserSlim(userId);
    if (status === 'canceled') {
      return res.status(402).json({
        code: 'subscription_inactive',
        message: 'Your subscription is inactive — resubscribe to continue.',
      });
    }
    const counter = await getCounter(userId);
    const limit = TIER_LIMITS[tier] ?? TIER_LIMITS.free;
    const packsRemaining = Math.max(0, packCredits - (counter?.packsUsed || 0));
    if ((counter?.count || 0) >= limit && packsRemaining <= 0) {
      return res.status(402).json({
        code: 'cap_reached',
        message: "You've used today's allowance — it resets tonight. Upgrade or add a pack for more.",
      });
    }
    const inc = { count: 1 };
    if ((counter?.count || 0) >= limit) inc.packsUsed = 1; // consuming a pack credit
    await counters().updateOne(
      { key: `${String(userId)}:${today()}` },
      { $inc: inc },
      { upsert: true },
    );
    req.tier = tier;
    req.fromPack = inc.packsUsed != null;
    return next();
  } catch (err) {
    return next();
  }
};

/** Subscription summary for the caller (no numbers exposed). */
const summary = () => async (userId) => {
  const { tier, status, packCredits } = await getUserSlim(userId);
  const counter = await getCounter(userId);
  return {
    tier,
    status,
    packsRemaining: Math.max(0, packCredits - (counter?.packsUsed || 0)),
  };
};

async function grantPack(userId, credits) {
  await users().updateOne({ _id: new mongoose.Types.ObjectId(String(userId)) }, { $inc: { packCredits: credits } });
}

async function setSubscription(userId, tier, status) {
  await users().updateOne(
    { _id: new mongoose.Types.ObjectId(String(userId)) },
    { $set: { subscriptionTier: tier, subscriptionStatus: status } },
  );
}

module.exports = { TIER_LIMITS, enforce, summary, grantPack, setSubscription, today };
