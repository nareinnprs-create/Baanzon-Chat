/**
 * Play Billing verification for the Android app (TWA, Digital Goods API).
 *
 * Flow: the client purchases through Play inside the TWA, then posts the
 * purchase token + product id here. This endpoint validates the purchase
 * against the Google Play Developer API, acknowledges it (Google requires
 * acknowledgement within 3 days or the purchase refunds itself), grants the
 * entitlement exactly like the Dodo webhook does, and records the payment in
 * the local billingpayments collection so both payment rails surface in one
 * admin view.
 *
 * Credentials: a Google Play service account with the androidpublisher scope,
 * in `GOOGLE_PLAY_SERVICE_ACCOUNT_FILE` (path to the JSON) or
 * `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (inline JSON).
 */
const express = require('express');
const crypto = require('crypto');
const { logger } = require('@librechat/data-schemas');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const usage = require('~/server/services/billing/usage');
const {
  PLAY_PRODUCTS,
  resolvePlayProduct,
} = require('~/server/services/billing/catalog');
const BillingPayment = require('@librechat/data-schemas').createBillingPaymentModel;

require('~/models');

const router = express.Router();
const authed = requireJwtAuth;

const PACKAGE_NAME = process.env.PLAY_PACKAGE_NAME || 'com.opraiz.baanzonchat';
const ANDROIDPUBLISHER = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

/** Least-recently-used-ish single-entry token cache keyed by expiry. */
let cachedAccessToken = null;

function serviceAccount() {
  const inline = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (inline) {
    try {
      return JSON.parse(inline);
    } catch (_e) {
      return null;
    }
  }
  const file = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE;
  if (file) {
    try {
      return JSON.parse(require('fs').readFileSync(file, 'utf8'));
    } catch (_e) {
      return null;
    }
  }
  return null;
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RS256 JWT assertion signed with the service account private key. */
function makeAssertion(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64url(
    Buffer.from(
      JSON.stringify({
        iss: sa.client_email,
        scope: PLAY_SCOPE,
        aud: OAUTH_TOKEN_URL,
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(sa.private_key));
  return `${header}.${claims}.${signature}`;
}

async function accessToken() {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60_000) {
    return cachedAccessToken.token;
  }
  const sa = serviceAccount();
  if (!sa || !sa.client_email || !sa.private_key) {
    throw new Error('Play Billing is not configured');
  }
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: makeAssertion(sa),
    }),
  });
  if (!res.ok) {
    throw new Error(`Google auth failed (${res.status})`);
  }
  const body = await res.json();
  cachedAccessToken = { token: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 };
  return cachedAccessToken.token;
}

async function publisher(path, method = 'GET') {
  const token = await accessToken();
  const res = await fetch(`${ANDROIDPUBLISHER}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/* Catalog for the Digital Goods API query (sku ids + kind; no money figures). */
router.get('/products', authed, (_req, res) => {
  const items = Object.keys(PLAY_PRODUCTS).map((sku) => ({
    sku,
    kind: PLAY_PRODUCTS[sku].kind,
  }));
  return res.json({ items });
});

router.post('/verify', authed, async (req, res) => {
  try {
    const { purchaseToken, productId } = req.body || {};
    const sku = resolvePlayProduct(productId || '');
    if (!purchaseToken || !sku) {
      return res.status(400).json({ message: 'Unknown product or missing purchase token' });
    }

    const userId = req.user?.id;
    const email = req.user?.email || '';
    let verified = false;
    let acknowledged = false;
    let orderId = '';

    if (sku.kind === 'subscription') {
      const { status, body } = await publisher(
        `/applications/${PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
      );
      if (status !== 200) {
        return res.status(400).json({ message: 'Purchase could not be verified' });
      }
      const state = body?.subscriptionState;
      verified =
        state === 'SUBSCRIPTION_STATE_ACTIVE' || state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD';
      const line = (body?.lineItems || []).find((li) => li.productId === productId);
      orderId = body?.orderId || line?.orderId || '';
      if (verified && (line?.acknowledgementState ?? body?.acknowledgementState) !== 'ACKNOWLEDGED') {
        const ack = await publisher(
          `/applications/${PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
          'POST',
          { orderId },
        );
        acknowledged = ack.status === 204 || ack.status === 200;
      } else {
        acknowledged = true;
      }
    } else {
      const { status, body } = await publisher(
        `/applications/${PACKAGE_NAME}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`,
      );
      if (status !== 200) {
        return res.status(400).json({ message: 'Purchase could not be verified' });
      }
      verified = body?.purchaseState === 0;
      orderId = body?.orderId || '';
      if (verified && body?.acknowledgementState !== 1) {
        const ack = await publisher(
          `/applications/${PACKAGE_NAME}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
          'POST',
          {},
        );
        acknowledged = ack.status === 204 || ack.status === 200;
      } else {
        acknowledged = true;
      }
    }

    if (!verified) {
      return res.status(400).json({ message: 'The purchase is not active' });
    }

    // Grant the entitlement exactly like the Dodo webhook does.
    if (sku.kind === 'pack') {
      await usage.grantPack(userId, sku.credits, sku.validDays || 30);
    } else {
      await usage.setSubscription(userId, sku.tier, 'active');
    }

    const payment = await BillingPayment.create({
      source: 'play',
      userId,
      email,
      externalId: orderId || purchaseToken.slice(0, 64),
      productId,
      kind: sku.kind,
      tier: sku.tier,
      pack: sku.pack,
      amount: sku.amountInr,
      currency: 'INR',
      status: 'paid',
      acknowledgedAt: acknowledged ? new Date() : undefined,
    });

    return res.json({
      verified: true,
      acknowledged,
      kind: sku.kind,
      tier: sku.tier,
      pack: sku.pack,
      credits: sku.credits,
      orderId: payment.externalId,
    });
  } catch (err) {
    logger.error('[billing-play] verify failed:', err);
    return res.status(500).json({ message: err.message || 'Verification failed' });
  }
});

/* The client's purchases, for the pricing page's current-state rendering. */
router.get('/purchases', authed, async (req, res) => {
  try {
    const items = await BillingPayment.find({ userId: req.user.id, source: 'play' })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
