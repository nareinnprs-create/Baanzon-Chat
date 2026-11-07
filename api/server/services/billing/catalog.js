/**
 * Subscription tiers, daily allowances (never published to users), and the
 * Dodo product catalog. Prices are INR list prices; Dodo presents local
 * payment methods and currency at checkout.
 */
const TIER_LIMITS = { free: 15, lite: 33, pro: 110, enterprise: 200 };

const PACKS = {
  lite_pack: { label: 'Lite pack', priceInr: 99, credits: 200, validDays: 30 },
  pro_pack: { label: 'Pro pack', priceInr: 199, credits: 500, validDays: 30 },
};

/** Dodo product ids are filled in via env once products exist on Dodo. */
const PRODUCTS = {
  lite: {
    tier: 'lite',
    label: 'Lite',
    inr: 299,
    yearlyInr: 2990,
    dodoProductId: process.env.DODO_PRODUCT_LITE || '',
    dodoProductIdYearly: process.env.DODO_PRODUCT_LITE_YEARLY || '',
  },
  pro: {
    tier: 'pro',
    label: 'Pro',
    inr: 999,
    yearlyInr: 9990,
    dodoProductId: process.env.DODO_PRODUCT_PRO || '',
    dodoProductIdYearly: process.env.DODO_PRODUCT_PRO_YEARLY || '',
  },
  enterprise: {
    tier: 'enterprise',
    label: 'Enterprise',
    inr: 9999,
    dodoProductId: process.env.DODO_PRODUCT_ENTERPRISE || '',
    dodoProductIdYearly: '',
  },
};

/** Map a Dodo product_id back to { tier, cycle } or a pack. */
function resolveProductId(productId) {
  for (const key of Object.keys(PRODUCTS)) {
    const p = PRODUCTS[key];
    if (p.dodoProductId === productId) return { tier: key, cycle: 'monthly' };
    if (p.dodoProductIdYearly && p.dodoProductIdYearly === productId) return { tier: key, cycle: 'yearly' };
  }
  for (const key of Object.keys(PACKS)) {
    if (PACKS[key].dodoProductId === productId) return { pack: key, credits: PACKS[key].credits };
  }
  return null;
}

function isMock() {
  return (process.env.DODO_MODE || 'mock').toLowerCase() === 'mock';
}

module.exports = { TIER_LIMITS, PACKS, PRODUCTS, resolveProductId, isMock };
