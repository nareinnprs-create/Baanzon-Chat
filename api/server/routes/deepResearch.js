const express = require('express');
const { createDeepResearchHandlers, createDeepResearchRunner } = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { projectsLimiter } = require('~/server/middleware/limiters');

const router = express.Router();

/**
 * Search: the self-hosted SearXNG instance (SEARXNG_INSTANCE_URL with a <query>
 * placeholder). LLM: the Opraiz gateway. With either absent the runner degrades
 * gracefully, so the route stays usable on unconfigured deployments.
 */
const searchProvider = {
  search: async (query, signal) => {
    const base = process.env.SEARXNG_INSTANCE_URL;
    if (!base) return [];
    const url = base.includes('<query>')
      ? base.replace('<query>', encodeURIComponent(query))
      : `${base}${base.includes('?') ? '&' : '?'}q=${encodeURIComponent(query)}`;
    const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}format=json`, { signal });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.results || [])
      .slice(0, 8)
      .map((x) => ({ title: x.title, url: x.url, snippet: x.content }));
  },
};

const llm = {
  complete: async (prompt, signal) => {
    const base = process.env.OPRAIZ_BASEURL;
    const key = process.env.OPRAIZ_API_KEY;
    const model = process.env.DEEP_RESEARCH_MODEL || '@cf/meta/llama-3.1-8b-instruct-fp8';
    if (!base || !key) throw new Error('LLM not configured');
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4000,
      }),
    });
    if (!r.ok) throw new Error(`LLM ${r.status}`);
    const j = await r.json();
    return j.choices?.[0]?.message?.content || '';
  },
};

const handlers = createDeepResearchHandlers({
  runner: createDeepResearchRunner({ searchProvider, llm }),
});

router.use(requireJwtAuth);
router.use(projectsLimiter);

router.post('/plan', handlers.createPlan);
router.get('/run', handlers.runStep);
router.post('/report', handlers.buildReport);

module.exports = router;
