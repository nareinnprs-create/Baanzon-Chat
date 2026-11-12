/**
 * Tier x brand -> model routing for Baanzon Chat.
 *
 * The client only ever sees and sends public keys: the baanzon.yaml modelSpec
 * slugs (PUBLIC_MODELS below) and the brand keys (`baanzon-ai` | `baanzon-ara`
 * | `baanzon-chenni`). routeModel resolves those keys to concrete model ids at
 * generation; brand keys additionally pick the model + context budget + reply
 * cap from the user's plan tier. Concrete model ids (e.g. `@cf/...`) pass
 * through untouched so in-flight clients and stored presets keep working.
 * Windows (from CF catalog): glm-4.7-flash 131k, glm-5.3-flash/glm-5.3/deepseek-v4-flash 1M,
 * gpt-oss-120b 128k, r1-32b 80k, coder-32b 32k, kimi 262k. Budgets stay under the window.
 */
const MATRIX = {
  'baanzon-ai': {
    free: { model: '@cf/zai-org/glm-4.7-flash', maxContextTokens: 120000, max_tokens: 8000 },
    lite: { model: '@cf/zai-org/glm-5.3-flash', maxContextTokens: 900000, max_tokens: 12000 },
    pro: { model: '@cf/openai/gpt-oss-120b', maxContextTokens: 112000, max_tokens: 16000 },
    enterprise: { model: '@cf/zai-org/glm-5.3', maxContextTokens: 900000, max_tokens: 16000 },
  },
  'baanzon-ara': {
    free: { model: '@cf/zai-org/glm-4.7-flash', maxContextTokens: 120000, max_tokens: 8000 },
    lite: {
      model: '@cf/deepseek-ai/deepseek-v4-flash-0731',
      maxContextTokens: 900000,
      max_tokens: 12000,
    },
    pro: { model: '@cf/zai-org/glm-5.3', maxContextTokens: 900000, max_tokens: 16000 },
    enterprise: {
      model: '@cf/deepseek-ai/deepseek-v4-flash-0731',
      maxContextTokens: 900000,
      max_tokens: 16000,
    },
  },
  'baanzon-chenni': {
    free: { model: '@cf/zai-org/glm-4.7-flash', maxContextTokens: 120000, max_tokens: 8000 },
    lite: {
      model: '@cf/qwen/qwen2.5-coder-32b-instruct',
      maxContextTokens: 24000,
      max_tokens: 12000,
    },
    pro: {
      model: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
      maxContextTokens: 64000,
      max_tokens: 16000,
    },
    enterprise: {
      model: '@cf/moonshotai/kimi-k2.7-code',
      maxContextTokens: 240000,
      max_tokens: 16000,
    },
  },
};

/**
 * Public model keys, mirroring baanzon.yaml modelSpecs (name -> preset.model).
 * Selecting a spec sends its slug; this is the only server-side place that
 * knows which concrete model stands behind it. Order matters for the reverse
 * map: when two keys share a raw id (glm-5.3), the first (the default spec) wins.
 */
const PUBLIC_MODELS = {
  'baanzon-intelligence': '@cf/zai-org/glm-5.3',
  'baanzon-flash': '@cf/zai-org/glm-5.3-flash',
  'baanzon-polyglot': '@cf/qwen/qwen3-30b-a3b-fp8',
  'baanzon-reasoning': '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
  'baanzon-reasoner': '@cf/openai/gpt-oss-120b',
  'baanzon-scribe': '@cf/zai-org/glm-5.3',
  'baanzon-code': '@cf/qwen/qwen2.5-coder-32b-instruct',
  'baanzon-code-xl': '@cf/moonshotai/kimi-k2.7-code',
  'baanzon-turbo': '@cf/meta/llama-3.1-8b-instruct-fp8',
  'baanzon-swift': '@cf/zai-org/glm-4.7-flash',
  'baanzon-rapid': '@cf/deepseek-ai/deepseek-v4-flash-0731',
  'baanzon-vision': '@cf/meta/llama-3.2-11b-vision-instruct',
};

const PUBLIC_MODEL_BY_RAW = {};
for (const [key, raw] of Object.entries(PUBLIC_MODELS)) {
  if (!(raw in PUBLIC_MODEL_BY_RAW)) {
    PUBLIC_MODEL_BY_RAW[raw] = key;
  }
}

/** Maps a concrete model id back to its public key, for user-facing payloads. */
function toPublicModelId(model) {
  return PUBLIC_MODEL_BY_RAW[String(model || '')];
}

const FALLBACK = {
  model: '@cf/meta/llama-3.1-8b-instruct-fp8',
  maxContextTokens: 28000,
  max_tokens: 4000,
};

const CHAT_LANE_BRANDS = {
  fast: 'baanzon-ai',
  balanced: 'baanzon-ai',
  reasoning: 'baanzon-ara',
  coding: 'baanzon-chenni',
};

function routeModel(tier, requested, lane) {
  const requestedStr = String(requested || '');
  const laneBrand = CHAT_LANE_BRANDS[String(lane || '').toLowerCase()];
  if (laneBrand) {
    return { ...routeModel(tier, laneBrand), lane: String(lane).toLowerCase() };
  }
  const publicModel = PUBLIC_MODELS[requestedStr];
  if (publicModel) {
    // Spec key: a concrete model the user picked by name — no tier budget override.
    return { model: publicModel };
  }
  if (!requestedStr.startsWith('baanzon-')) {
    return null; // concrete model id — no routing, no budget override
  }
  const brand = MATRIX[requestedStr] ? requestedStr : 'baanzon-ai';
  const t = String(tier || 'free').toLowerCase();
  return MATRIX[brand][t] || MATRIX[brand].free;
}

module.exports = {
  routeModel,
  MATRIX,
  FALLBACK,
  CHAT_LANE_BRANDS,
  PUBLIC_MODELS,
  toPublicModelId,
};
