/**
 * Dodo Payments billing routes. DODO_MODE=mock for dev, live for production.
 * API key + webhook secret in .env only.
 */
const express = require('express');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const usage = require('~/server/services/billing/usage');
const { PRODUCTS, PACKS, resolveProductId, isMock } = require('~/server/services/billing/catalog');

const router = express.Router();
const authed = requireJwtAuth;
const DODO_BASE = process.env.DODO_BASE_URL || 'https://live.dodopayments.com';
const DODO_KEY = process.env.DODO_API_KEY || '';
const DODO_WEBHOOK_SECRET = process.env.DODO_WEBHOOK_SECRET || '';

/* products (public) */
router.get('/products', (req, res) => {
  const products = Object.entries(PRODUCTS).map(([tier, p]) => ({
    tier, label: p.label, inrMonthly: p.inr, inrYearly: p.yearlyInr || null,
  }));
  const packs = Object.entries(PACKS).map(([key, p]) => ({ pack: key, label: p.label, inr: p.priceInr, credits: p.credits }));
  res.json({ products, packs });
});

/* checkout (authed) — creates a Dodo checkout session or mock redirect */
router.post('/checkout', authed, async (req, res) => {
  try {
    const { tier: rawTier, cycle = 'monthly' } = req.body || {};
    const product = PRODUCTS[(rawTier || '').toLowerCase()];
    if (!product) return res.status(400).json({ message: 'Unknown tier' });

    if (isMock()) {
      return res.json({ mock: true, url: `/pricing?mock_checkout=${rawTier}&cycle=${cycle}`, tier: rawTier, cycle });
    }

    const productId = cycle === 'yearly' ? product.dodoProductIdYearly : product.dodoProductId;
    if (!productId) return res.status(400).json({ message: 'Product not configured' });

    const cr = await fetch(`${DODO_BASE}/checkouts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${DODO_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_cart: [{ product_id: productId, quantity: 1 }],
        customer: { email: req.user?.email || '', name: req.user?.name || '' },
        billing_currency: 'INR',
        return_url: (process.env.DOMAIN_CLIENT || '') + '/settings?billing=return',
        metadata: { userId: String(req.user?.id || ''), tier: rawTier, cycle },
      }),
    });
    const cb = await cr.json().catch(() => ({}));
    if (!cr.ok || !cb.checkout_url) return res.status(cr.status || 500).json({ message: cb.message || 'Checkout failed' });
    return res.json({ url: cb.checkout_url });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

/* webhook (Dodo -> us) */
router.post('/webhook', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
  try {
    if (DODO_WEBHOOK_SECRET && req.headers['webhook-secret'] !== DODO_WEBHOOK_SECRET) {
      return res.status(401).json({ message: 'invalid webhook secret' });
    }
    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const type = event.type || '';
    const payload = event.data || event;
    const userId = payload?.metadata?.userId || payload?.subscription?.metadata?.userId;
    if (!userId) return res.json({ received: true, ignored: 'no userId' });
    const productId = payload?.product_id || payload?.subscription?.product_id || '';
    const resolved = resolveProductId(productId);

    if (type.startsWith('subscription.') && resolved?.tier) {
      if (type === 'subscription.cancelled' || payload?.status === 'cancelled') {
        await usage.setSubscription(userId, resolved.tier, 'canceled');
      } else {
        await usage.setSubscription(userId, resolved.tier, 'active');
      }
      return res.json({ received: true });
    }
    if (resolved?.pack && (type === 'payment.succeeded' || payload?.status === 'succeeded')) {
      await usage.grantPack(userId, resolved.credits);
      return res.json({ received: true, pack: resolved.pack });
    }
    return res.json({ received: true, ignored: type || 'unmatched' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

/* subscription summary (authed, no numbers exposed) */
router.get('/subscription', authed, async (req, res) => {
  try {
    const s = await usage.summary()(req.user.id);
    return res.json(s);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

/* mock purchase (mock mode only, authed) */
router.post('/mock/purchase', authed, async (req, res) => {
  if (!isMock()) return res.status(403).json({ message: 'mock only' });
  try {
    const { tier, cycle, pack } = req.body || {};
    if (pack && PACKS[pack]) {
      await usage.grantPack(req.user.id, PACKS[pack].credits);
      return res.json({ ok: true, pack, credits: PACKS[pack].credits });
    }
    const product = PRODUCTS[(tier || '').toLowerCase()];
    if (!product) return res.status(400).json({ message: 'Unknown tier' });
    await usage.setSubscription(req.user.id, product.tier, 'active');
    return res.json({ ok: true, tier: product.tier, cycle });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
