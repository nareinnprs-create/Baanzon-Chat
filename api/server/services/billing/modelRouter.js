/**
 * Tier x brand -> model routing for Baanzon Chat.
 * The client sends a brand key (`baanzon-ai` | `baanzon-ara` | `baanzon-chenni`);
 * the user's plan tier picks the model + context budget + reply cap.
 * Concrete model ids (e.g. `@cf/...` from API probes) pass through untouched.
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
    lite: { model: '@cf/deepseek-ai/deepseek-v4-flash-0731', maxContextTokens: 900000, max_tokens: 12000 },
    pro: { model: '@cf/zai-org/glm-5.3', maxContextTokens: 900000, max_tokens: 16000 },
    enterprise: { model: '@cf/deepseek-ai/deepseek-v4-flash-0731', maxContextTokens: 900000, max_tokens: 16000 },
  },
  'baanzon-chenni': {
    free: { model: '@cf/zai-org/glm-4.7-flash', maxContextTokens: 120000, max_tokens: 8000 },
    lite: { model: '@cf/qwen/qwen2.5-coder-32b-instruct', maxContextTokens: 24000, max_tokens: 12000 },
    pro: { model: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', maxContextTokens: 64000, max_tokens: 16000 },
    enterprise: { model: '@cf/moonshotai/kimi-k2.7-code', maxContextTokens: 240000, max_tokens: 16000 },
  },
};

const FALLBACK = { model: '@cf/meta/llama-3.1-8b-instruct-fp8', maxContextTokens: 28000, max_tokens: 4000 };

function routeModel(tier, requested) {
  const requestedStr = String(requested || '');
  if (!requestedStr.startsWith('baanzon-')) {
    return null; // concrete model id — no routing, no budget override
  }
  const brand = MATRIX[requestedStr] ? requestedStr : 'baanzon-ai';
  const t = String(tier || 'free').toLowerCase();
  return MATRIX[brand][t] || MATRIX[brand].free;
}

module.exports = { routeModel, MATRIX, FALLBACK };
