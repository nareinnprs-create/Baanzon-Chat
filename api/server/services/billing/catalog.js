/**
 * Subscription tiers, daily allowances (never published to users), and the
 * Dodo product catalog. Prices are INR list prices; Dodo presents local
 * payment methods and currency at checkout.
 */
const TIER_LIMITS = { free: 15, lite: 33, pro: 110, enterprise: 200 };

const PACKS = {
  lite_pack: {
    label: 'Lite pack',
    priceInr: 99,
    credits: 200,
    validDays: 30,
    dodoProductId: process.env.DODO_PRODUCT_LITE_PACK || 'pdt_0NrCa0mcDz1W3X7SyIKl9',
  },
  pro_pack: {
    label: 'Pro pack',
    priceInr: 199,
    credits: 500,
    validDays: 30,
    dodoProductId: process.env.DODO_PRODUCT_PRO_PACK || 'pdt_0NrCa0pLQIuSHJfO1P4kl',
  },
};

/**
 * Dodo product ids verified live on 2026-11-10 (audit of the Dodo catalog);
 * env overrides for staging/mock setups. Pack ids live on the PACKS entries.
 */
const PRODUCTS = {
  lite: {
    tier: 'lite',
    label: 'Lite',
    inr: 299,
    yearlyInr: 2990,
    dodoProductId: process.env.DODO_PRODUCT_LITE || 'pdt_0NrCZm4oJpnpvLLCUWAw2',
    dodoProductIdYearly: process.env.DODO_PRODUCT_LITE_YEARLY || 'pdt_0NrCa0cM7TU6Veh0MDmQ5',
  },
  pro: {
    tier: 'pro',
    label: 'Pro',
    inr: 999,
    yearlyInr: 9990,
    dodoProductId: process.env.DODO_PRODUCT_PRO || 'pdt_0NrCa0fQT8txsnXAe9DVn',
    dodoProductIdYearly: process.env.DODO_PRODUCT_PRO_YEARLY || 'pdt_0NrCa0hZR9JFyr9nbSTN9',
  },
  enterprise: {
    tier: 'enterprise',
    label: 'Enterprise',
    inr: 9999,
    dodoProductId: process.env.DODO_PRODUCT_ENTERPRISE || 'pdt_0NrCa0jSXKPDEHCets7go',
    dodoProductIdYearly: '',
  },
};

/** Map a Dodo product_id back to { tier, cycle } or a pack. */
function resolveProductId(productId) {
  for (const key of Object.keys(PRODUCTS)) {
    const p = PRODUCTS[key];
    if (p.dodoProductId === productId) return { tier: key, cycle: 'monthly' };
    if (p.dodoProductIdYearly && p.dodoProductIdYearly === productId)
      return { tier: key, cycle: 'yearly' };
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
