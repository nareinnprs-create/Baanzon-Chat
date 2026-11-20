/**
 * Baanzon model system v2: five public models, tier-resolved failover chains.
 *
 * The client only ever sees and sends public keys: the five baanzon.yaml spec
 * slugs (PUBLIC_MODELS below) and a capability `lane` (fast/balanced/reasoning/
 * vision/coding). routeModel resolves those to a concrete model id at
 * generation: the slug picks the public model, the tier picks the primary
 * backing, and the chain carries equally-powerful alternates for automatic
 * failover (see installModelFailover). Concrete `@cf/...` ids pass through
 * untouched so in-flight clients and stored presets keep working.
 *
 * Indic lane: when the message text carries Indic script (any of the 22
 * scheduled languages), the same chain reorders Indic-strongest first, so
 * every public model answers Indian languages from its best backings.
 *
 * Windows (live-probed 2026-11-20): glm-4.7-flash 131k, glm-5.3/
 * deepseek-v4.1-flash 1M, gpt-oss-120b 128k, gpt-oss-20b 128k, coder-32b 32k,
 * llama-3.3-70b 128k, llama-3.2-3b 128k, llama-4-scout 256k,
 * llama-3.2-11b-vision 128k, mistral-small 128k, gemma-4-26b 128k. Budgets
 * stay under the window.
 */
const { encodeEphemeralAgentId, parseEphemeralAgentId } = require('librechat-data-provider');

/** Context/reply budgets per tier (shared across models; windows are bigger). */
const TIER_BUDGETS = {
  free: { maxContextTokens: 120000, max_tokens: 8000 },
  lite: { maxContextTokens: 900000, max_tokens: 12000 },
  pro: { maxContextTokens: 900000, max_tokens: 16000 },
  enterprise: { maxContextTokens: 900000, max_tokens: 16000 },
};

/** Per-model overrides where the primary window is smaller than the tier default. */
const MODEL_BUDGET_OVERRIDES = {
  'baanzon-reasoning': {
    free: { maxContextTokens: 64000, max_tokens: 8000 },
    pro: { maxContextTokens: 112000, max_tokens: 16000 },
  },
  'baanzon-code': {
    free: { maxContextTokens: 24000, max_tokens: 8000 },
    lite: { maxContextTokens: 24000, max_tokens: 12000 },
    pro: { maxContextTokens: 240000, max_tokens: 16000 },
    enterprise: { maxContextTokens: 240000, max_tokens: 16000 },
  },
  'baanzon-swift': {
    free: { maxContextTokens: 120000, max_tokens: 8000 },
    lite: { maxContextTokens: 120000, max_tokens: 12000 },
    pro: { maxContextTokens: 900000, max_tokens: 16000 },
    enterprise: { maxContextTokens: 900000, max_tokens: 16000 },
  },
  'baanzon-vision': {
    free: { maxContextTokens: 112000, max_tokens: 8000 },
    lite: { maxContextTokens: 112000, max_tokens: 12000 },
    pro: { maxContextTokens: 112000, max_tokens: 16000 },
    enterprise: { maxContextTokens: 112000, max_tokens: 16000 },
  },
};

/**
 * Ordered failover chains: slug x tier -> concrete model ids, equally-powerful
 * primary first. installGatewayFailover hops to the next id on 404/410/429/5xx
 * before the first token, so a deprecated or saturated model never errors.
 * Every member was live-probed against the account (2026-11-20); the previous
 * set lost 7 chat + 4 image models to deprecation.
 */
const CHAINS = {
  'baanzon-intelligence': {
    free: ['@cf/zai-org/glm-4.7-flash', '@cf/openai/gpt-oss-20b', '@cf/zai-org/glm-5.3'],
    lite: ['@cf/zai-org/glm-5.3', '@cf/zai-org/glm-4.7-flash', '@cf/openai/gpt-oss-20b'],
    pro: [
      '@cf/zai-org/glm-5.3',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/openai/gpt-oss-120b',
    ],
    enterprise: [
      '@cf/zai-org/glm-5.3',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/openai/gpt-oss-120b',
    ],
  },
  'baanzon-reasoning': {
    free: [
      '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
      '@cf/openai/gpt-oss-120b',
      '@cf/zai-org/glm-5.3',
    ],
    lite: [
      '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
      '@cf/openai/gpt-oss-120b',
      '@cf/zai-org/glm-5.3',
    ],
    pro: [
      '@cf/openai/gpt-oss-120b',
      '@cf/zai-org/glm-5.3',
      '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
    ],
    enterprise: [
      '@cf/openai/gpt-oss-120b',
      '@cf/zai-org/glm-5.3',
      '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
    ],
  },
  'baanzon-code': {
    free: [
      '@cf/qwen/qwen2.5-coder-32b-instruct',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/zai-org/glm-5.3',
    ],
    lite: [
      '@cf/qwen/qwen2.5-coder-32b-instruct',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/zai-org/glm-5.3',
    ],
    pro: [
      '@cf/qwen/qwen2.5-coder-32b-instruct',
      '@cf/google/gemma-4-26b-a4b-it',
      '@cf/zai-org/glm-5.3',
    ],
    enterprise: [
      '@cf/qwen/qwen2.5-coder-32b-instruct',
      '@cf/google/gemma-4-26b-a4b-it',
      '@cf/zai-org/glm-5.3',
    ],
  },
  'baanzon-swift': {
    free: ['@cf/zai-org/glm-4.7-flash', '@cf/meta/llama-3.2-3b-instruct'],
    lite: ['@cf/zai-org/glm-4.7-flash', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
    pro: ['@cf/zai-org/glm-5.3', '@cf/openai/gpt-oss-20b'],
    enterprise: ['@cf/zai-org/glm-5.3', '@cf/openai/gpt-oss-20b'],
  },
  'baanzon-vision': {
    free: [
      '@cf/meta/llama-3.2-11b-vision-instruct',
      '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
      '@cf/mistralai/mistral-small-3.1-24b-instruct',
    ],
    lite: [
      '@cf/meta/llama-3.2-11b-vision-instruct',
      '@cf/mistralai/mistral-small-3.1-24b-instruct',
      '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
    ],
    pro: [
      '@cf/meta/llama-4-scout-17b-16e-instruct',
      '@cf/mistralai/mistral-small-3.1-24b-instruct',
      '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
    ],
    enterprise: [
      '@cf/meta/llama-4-scout-17b-16e-instruct',
      '@cf/mistralai/mistral-small-3.1-24b-instruct',
      '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
    ],
  },
};

/** The five public slugs (spec names in baanzon.yaml). Exported for callers
 *  that validate user-sent keys. */
const PUBLIC_MODELS = Object.keys(CHAINS);

/** Legacy keys (v1 brand keys + retired spec slugs) -> current slug. Stored
 *  conversations and old clients keep working; never surfaces in the UI. */
const ALIASES = {
  baanzon: 'baanzon-intelligence',
  'baanzon-ai': 'baanzon-intelligence',
  'baanzon-flash': 'baanzon-intelligence',
  'baanzon-polyglot': 'baanzon-intelligence',
  'baanzon-scribe': 'baanzon-intelligence',
  'baanzon-ara': 'baanzon-reasoning',
  'baanzon-reasoner': 'baanzon-reasoning',
  'baanzon-chenni': 'baanzon-code',
  'baanzon-code-xl': 'baanzon-code',
  'baanzon-turbo': 'baanzon-swift',
  'baanzon-rapid': 'baanzon-swift',
};

/** Capability lane -> public model. `balanced` keeps the requested slug (the
 *  user's/spec's choice); the other lanes route to the lane's own model. */
const LANE_SLUGS = {
  fast: 'baanzon-swift',
  reasoning: 'baanzon-reasoning',
  coding: 'baanzon-code',
  vision: 'baanzon-vision',
};

/** Indic scripts (scheduled languages): Devanagari, Bengali-Assamese,
 *  Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala. */
const INDIC_SCRIPT_RE =
  /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0D80-\u0DFF]/;

/** Indic strength ranking (lower = stronger) used to reorder a chain when the
 *  message is Indic. Members absent from the map sort last, order preserved. */
const INDIC_RANK = {
  '@cf/zai-org/glm-5.3': 0,
  '@cf/deepseek-ai/deepseek-v4.1-flash-1017': 1,
  '@cf/google/gemma-4-26b-a4b-it': 2,
  '@cf/qwen/qwen2.5-coder-32b-instruct': 3,
  '@cf/zai-org/glm-4.7-flash': 4,
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': 5,
  '@cf/openai/gpt-oss-120b': 6,
  '@cf/openai/gpt-oss-20b': 7,
  '@cf/mistralai/mistral-small-3.1-24b-instruct': 8,
  '@cf/meta/llama-4-scout-17b-16e-instruct': 9,
  '@cf/meta/llama-3.2-11b-vision-instruct': 10,
  '@cf/meta/llama-3.2-3b-instruct': 11,
};

/** Detects the 22 scheduled Indian languages by Unicode script range. */
function isIndicText(text) {
  return typeof text === 'string' && INDIC_SCRIPT_RE.test(text);
}

/** The slug's tier chain, Indic-strongest first when the text is Indic. */
function resolveModelChain(tier, slug, text) {
  const normalizedSlug = ALIASES[slug] ?? slug;
  const tiers = CHAINS[normalizedSlug];
  if (!tiers) {
    return [];
  }
  const chain = (tiers[String(tier || 'free').toLowerCase()] || tiers.free).slice();
  if (isIndicText(text)) {
    chain.sort((a, b) => (INDIC_RANK[a] ?? 99) - (INDIC_RANK[b] ?? 99));
  }
  return chain;
}

/** raw id -> its ordered alternates (same chain, minus itself), for the fetch
 *  failover wrapper that never sees the slug or tier. */
const RAW_FAILOVER = {};
for (const tiers of Object.values(CHAINS)) {
  for (const chain of Object.values(tiers)) {
    chain.forEach((raw, index) => {
      const rest = chain.slice(index + 1);
      const existing = RAW_FAILOVER[raw];
      if (!existing) {
        RAW_FAILOVER[raw] = rest.slice();
        return;
      }
      for (const candidate of rest) {
        if (!existing.includes(candidate)) {
          existing.push(candidate);
        }
      }
    });
  }
}

const FALLBACK = {
  model: '@cf/zai-org/glm-4.7-flash',
  maxContextTokens: 120000,
  max_tokens: 8000,
};

/**
 * Resolves a generation request to its concrete model and budgets.
 * - concrete `@cf/...` ids pass through (stored presets keep working)
 * - slug (or lane, or legacy alias) resolves into the slug's tier chain
 * - `text` (optional) triggers the Indic reorder
 * Returns { model, maxContextTokens, max_tokens, chain } or null when the
 * request is not a Baanzon key and not a concrete model id.
 */
function routeModel(tier, requested, lane, text) {
  const requestedStr = String(requested || '');
  if (requestedStr.startsWith('@cf/')) {
    return { model: requestedStr };
  }

  const t = String(tier || 'free').toLowerCase();
  const laneSlug = LANE_SLUGS[String(lane || '').toLowerCase()];
  const slug = laneSlug ?? ALIASES[requestedStr] ?? (PUBLIC_MODELS.includes(requestedStr) ? requestedStr : null);

  if (!slug) {
    return null;
  }

  const chain = resolveModelChain(t, slug, text);
  if (chain.length === 0) {
    return null;
  }

  const budgets = {
    ...(TIER_BUDGETS[t] || TIER_BUDGETS.free),
    ...(MODEL_BUDGET_OVERRIDES[slug]?.[t] || {}),
  };
  return { model: chain[0], ...budgets, chain };
}

/** Maps a concrete model id back to its public slug, for user-facing payloads.
 *  Every chain member maps, so failover never leaks a vendor id to the UI. */
const PUBLIC_MODEL_BY_RAW = {};
for (const [slug, tiers] of Object.entries(CHAINS)) {
  for (const chain of Object.values(tiers)) {
    for (const raw of chain) {
      if (!(raw in PUBLIC_MODEL_BY_RAW)) {
        PUBLIC_MODEL_BY_RAW[raw] = slug;
      }
    }
  }
}

/** Resolves any Baanzon key (public slug, legacy alias or concrete id) to the
 *  concrete id to send for a context-free caller (the gateway fetch wrapper
 *  has no request tier; the free chain's primary is the shared default). */
function resolvePublicModelKey(key) {
  const raw = String(key || '');
  if (raw.startsWith('@cf/')) {
    return raw;
  }
  const slug = ALIASES[raw] ?? (PUBLIC_MODELS.includes(raw) ? raw : null);
  if (!slug) {
    return raw;
  }
  return CHAINS[slug].free[0];
}

function toPublicModelId(model) {
  return PUBLIC_MODEL_BY_RAW[String(model || '')];
}

/**
 * Rebrands the model part of a stored composite ephemeral agent id
 * (`endpoint__model___sender`, optionally `____index`) for user-facing reads.
 * Real `agent_*` ids, unparseable values and already-public keys pass through
 * untouched; a concrete vendor id with no public key drops the attribution
 * (returns null) rather than leaking the raw id.
 */
function toPublicAgentId(agentId) {
  if (typeof agentId !== 'string' || agentId.startsWith('agent_')) {
    return agentId;
  }
  const parsed = parseEphemeralAgentId(agentId);
  if (!parsed) {
    return agentId;
  }
  const pub = toPublicModelId(parsed.model);
  if (pub) {
    return encodeEphemeralAgentId({ ...parsed, model: pub });
  }
  // shortcut: only @cf/ ids count as unmappable vendor ids; a future raw id
  // with another prefix would pass through and needs this check widened.
  if (parsed.model.startsWith('@cf/')) {
    return null;
  }
  return agentId;
}

module.exports = {
  routeModel,
  resolveModelChain,
  isIndicText,
  CHAINS,
  PUBLIC_MODELS,
  ALIASES,
  LANE_SLUGS,
  RAW_FAILOVER,
  FALLBACK,
  TIER_BUDGETS,
  resolvePublicModelKey,
  toPublicModelId,
  toPublicAgentId,
};
