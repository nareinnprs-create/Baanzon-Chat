/**
 * Tier x brand -> model routing for Baanzon Chat.
 * The client sends a brand key (`baanzon-ai` | `baanzon-ara` | `baanzon-chenni`);
 * the user's plan tier picks the concrete Cloudflare Workers AI model.
 * Concrete model ids (e.g. `@cf/...` from API probes) pass through untouched.
 */
const MATRIX = {
  'baanzon-ai': {
    free: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    lite: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    pro: '@cf/openai/gpt-oss-120b',
    enterprise: '@cf/zai-org/glm-5.3',
  },
  'baanzon-ara': {
    free: '@cf/zai-org/glm-4.7-flash',
    lite: '@cf/qwen/qwen3-30b-a3b-fp8',
    pro: '@cf/zai-org/glm-5.3',
    enterprise: '@cf/openai/gpt-oss-120b',
  },
  'baanzon-chenni': {
    free: '@cf/zai-org/glm-4.7-flash',
    lite: '@cf/qwen/qwen2.5-coder-32b-instruct',
    pro: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    enterprise: '@cf/deepseek-ai/deepseek-v4-flash-0731',
  },
};

const FALLBACK = '@cf/meta/llama-3.1-8b-instruct-fp8';

function routeModel(tier, requested) {
  const requestedStr = String(requested || '');
  if (!requestedStr.startsWith('baanzon-')) {
    return requestedStr; // concrete model id (API probes, legacy clients) — pass through
  }
  const brand = MATRIX[requestedStr] ? requestedStr : 'baanzon-ai';
  const t = String(tier || 'free').toLowerCase();
  return MATRIX[brand][t] || MATRIX[brand].free;
}

module.exports = { routeModel, MATRIX, FALLBACK };
