/**
 * Subscription tiers, daily allowances (never published to users), and the
 * Dodo product catalog. Prices are INR list prices; Dodo presents local
 * payment methods and currency at checkout.
 */
const TIER_LIMITS = { free: 30, lite: 50, pro: 150, enterprise: 300 };

const PACKS = {
  lite_pack: {
    label: 'Lite pack',
    priceInr: 99,
    credits: 200,
    validDays: 30,
    dodoProductId: process.env.DODO_PRODUCT_LITE_PACK || 'pdt_0NrCa0mcDz1W3X7SyIKl9',
    playProductId: process.env.PLAY_PRODUCT_LITE_PACK || 'baanzon_pack_lite',
  },
  pro_pack: {
    label: 'Pro pack',
    priceInr: 199,
    credits: 500,
    validDays: 30,
    dodoProductId: process.env.DODO_PRODUCT_PRO_PACK || 'pdt_0NrCa0pLQIuSHJfO1P4kl',
    playProductId: process.env.PLAY_PRODUCT_PRO_PACK || 'baanzon_pack_pro',
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
    playProductId: process.env.PLAY_PRODUCT_LITE || 'baanzon_lite_monthly',
    playProductIdYearly: process.env.PLAY_PRODUCT_LITE_YEARLY || 'baanzon_lite_yearly',
  },
  pro: {
    tier: 'pro',
    label: 'Pro',
    inr: 999,
    yearlyInr: 9990,
    dodoProductId: process.env.DODO_PRODUCT_PRO || 'pdt_0NrCa0fQT8txsnXAe9DVn',
    dodoProductIdYearly: process.env.DODO_PRODUCT_PRO_YEARLY || 'pdt_0NrCa0hZR9JFyr9nbSTN9',
    playProductId: process.env.PLAY_PRODUCT_PRO || 'baanzon_pro_monthly',
    playProductIdYearly: process.env.PLAY_PRODUCT_PRO_YEARLY || 'baanzon_pro_yearly',
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

/** Play Billing catalog: sku -> { kind, tier?, pack?, cycle?, amountInr }. */
const PLAY_PRODUCTS = {};
for (const key of Object.keys(PACKS)) {
  PLAY_PRODUCTS[PACKS[key].playProductId] = {
    kind: 'pack',
    pack: key,
    credits: PACKS[key].credits,
    amountInr: PACKS[key].priceInr,
  };
}
for (const tier of Object.keys(PRODUCTS)) {
  const p = PRODUCTS[tier];
  if (p.playProductId) {
    PLAY_PRODUCTS[p.playProductId] = { kind: 'subscription', tier, cycle: 'monthly', amountInr: p.inr };
  }
  if (p.playProductIdYearly) {
    PLAY_PRODUCTS[p.playProductIdYearly] = { kind: 'subscription', tier, cycle: 'yearly', amountInr: p.yearlyInr };
  }
}

function resolvePlayProduct(playProductId) {
  return PLAY_PRODUCTS[playProductId] || null;
}

function isMock() {
  // Live by default: a deploy that forgets DODO_MODE must not silently enable
  // the mock purchase route that grants plans to any signed-in user.
  return (process.env.DODO_MODE || 'live').toLowerCase() === 'mock';
}

module.exports = { TIER_LIMITS, PACKS, PRODUCTS, PLAY_PRODUCTS, resolveProductId, resolvePlayProduct, isMock };
