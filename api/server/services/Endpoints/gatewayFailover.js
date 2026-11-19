/**
 * Gateway failover for the Opraiz gateway (Cloudflare Workers AI, the only
 * real provider). Wraps global fetch once at startup so every call site that
 * hits the gateway (agents runtime, embeddings, triggers) is covered:
 *
 * - Chat requests: primary model first every request ("always the best
 *   provider"), then on 5xx/429/400/404/403/410 or a network error rewrite the
 *   body's model to the next id in the chain and retry. Retries happen before
 *   any response reaches the caller, so a consumed SSE stream is never re-run.
 *   403 (entitlement), 410 (deprecated) and a 200 with an empty chat message
 *   count as model failures, not successes.
 * - Chains are config-driven (`baanzon.yaml` `failover.chains`, keyed by
 *   concrete model id; `failover.defaultChain` covers the rest). Lane/tier
 *   routing resolves the request to one primary model first, so a model-keyed
 *   chain is the per-lane/tier ladder. Without config: primary ->
 *   glm-4.7-flash -> FALLBACK.
 * - Health tracker: after `failureThreshold` consecutive failed attempts a
 *   model is benched for `cooldownMs` and skipped at the front of future
 *   chains (never all of them — a fully benched chain still runs).
 * - Public model keys (e.g. the memory agent's 'baanzon-flash') resolve to
 *   their concrete @cf/ ids before the first send — the gateway rejects
 *   anything else with "No such model".
 * - Other gateway calls (embeddings etc.): retry the same body once on
 *   5xx/429/network errors — the model must not change, no health tracking.
 * - Non-gateway traffic passes through untouched.
 *
 * Fetch-only by design: all gateway callers use global fetch. If a caller
 * ever switches to axios, it needs its own wrapper here.
 */
const { logger } = require('@librechat/data-schemas');
const { FALLBACK, RAW_FAILOVER, resolvePublicModelKey } = require('../billing/modelRouter');

/** Tail for ids with no approved chain (ad-hoc models). */
const SECONDARY = '@cf/zai-org/glm-4.7-flash';

/** Defaults that reproduce the pre-config behavior; overridden by failover config. */
const DEFAULT_FAILURE_THRESHOLD = 2;
const DEFAULT_COOLDOWN_MS = 600000;

const CHAT_RETRY_STATUS = new Set([400, 403, 404, 410, 429]);
const PLAIN_RETRY_STATUS = new Set([429]);

/** Consecutive chat failures per model; a bench puts the model on cooldown. */
const health = new Map();

function isRetryable(status, chat) {
  return status >= 500 || (chat ? CHAT_RETRY_STATUS.has(status) : PLAIN_RETRY_STATUS.has(status));
}

/** Rewrites the JSON body's model id; returns the original body if not rewriteable. */
function rewriteBody(body, nextModel) {
  if (typeof body !== 'string') {
    return body;
  }
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.model === 'string') {
      parsed.model = nextModel;
      return JSON.stringify(parsed);
    }
  } catch (_e) {
    // not JSON — transient retry can still help
  }
  return body;
}

/** True when this init's body can be re-sent (stream handles cannot). */
function bodyReusable(body) {
  return (
    body == null ||
    typeof body === 'string' ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  );
}

/**
 * Ordered chain for a chat model: the configured ladder for this id (from
 * `failover.chains` config), else the approved MODEL_CHAINS alternates for
 * this concrete id, else the built-in primary -> secondary -> fallback tail.
 */
function chatChain(model, cfg) {
  const configured = cfg?.chains?.[model] ?? cfg?.defaultChain;
  const chain = configured
    ? [model, ...configured]
    : [model, ...(RAW_FAILOVER[model] ?? [SECONDARY, FALLBACK.model])];
  return [...new Set(chain.filter(Boolean))];
}

function recordFailure(model, cfg) {
  if (!model || !model.startsWith('@cf/')) {
    return;
  }
  const threshold = cfg?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
  const cooldownMs = cfg?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const entry = health.get(model) ?? { fails: 0, until: 0 };
  entry.fails += 1;
  if (entry.fails >= threshold) {
    entry.until = Date.now() + cooldownMs;
    entry.fails = 0;
    logger.warn(`[gatewayFailover] benching ${model} for ${cooldownMs}ms after repeated failures`);
  }
  health.set(model, entry);
}

function recordSuccess(model) {
  if (model && health.has(model)) {
    health.delete(model);
  }
}

function isBenched(model, now = Date.now()) {
  const entry = health.get(model);
  if (!entry) {
    return false;
  }
  if (entry.until > now) {
    return true;
  }
  if (entry.until) {
    health.delete(model); // cooldown expired — allow a fresh trial
  }
  return false;
}

/** True when a parsed 200 chat body carries no usable content (empty-200). */
function isEmptyChat200(parsed) {
  const msg = parsed?.choices?.[0]?.message;
  if (!msg) {
    return true;
  }
  if (typeof msg.content === 'string' && msg.content.trim()) {
    return false;
  }
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    return false;
  }
  if (msg.reasoning_content || msg.reasoning) {
    return false;
  }
  return true;
}

/**
 * Returns a fetch that adds the failover behavior for the gateway origin.
 * `getCfg` resolves the `failover` config block (undefined = defaults).
 * Exported for tests; `installGatewayFailover` wires it onto global fetch.
 */
function wrapGatewayFetch(inner, gatewayBase, getCfg) {
  let gw;
  try {
    gw = new URL(gatewayBase);
  } catch (_e) {
    logger.error(
      `[gatewayFailover] invalid OPRAIZ_BASEURL, failover not installed: ${gatewayBase}`,
    );
    return inner;
  }
  let seenFirst = false;

  return async function gatewayFetch(input, init) {
    if (typeof input !== 'string' && !(input instanceof URL)) {
      return inner(input, init); // Request objects: pass through untouched
    }
    let url;
    try {
      url = new URL(input, gw);
    } catch (_e) {
      return inner(input, init);
    }
    const onGateway =
      url.origin === gw.origin && url.pathname.startsWith(gw.pathname.replace(/\/$/, ''));
    if (!onGateway || !bodyReusable(init?.body)) {
      return inner(input, init);
    }
    if (!seenFirst) {
      seenFirst = true;
      logger.info(`[gatewayFailover] first gateway request observed (${url.host})`);
    }

    const chat = /\/(chat\/completions|completions|responses)$/.test(url.pathname);
    const meta = (() => {
      try {
        return JSON.parse(init.body || '{}');
      } catch (_e) {
        return {};
      }
    })();
    const rawModel = typeof meta.model === 'string' ? meta.model : '';
    // Public model keys (baanzon.yaml agent configs like the memory agent's
    // 'baanzon-flash') resolve to their concrete ids before the first send;
    // the gateway only knows @cf/ ids.
    const resolvedModel = resolvePublicModelKey(rawModel) || rawModel;
    const baseBody = resolvedModel === rawModel ? init.body : rewriteBody(init.body, resolvedModel);
    const cfg = getCfg ? await getCfg() : undefined;

    // chat: primary -> chain (model rewritten per attempt);
    // anything else: two attempts with the same body.
    const candidates =
      chat && resolvedModel.startsWith('@cf/')
        ? chatChain(resolvedModel, cfg)
        : [null, null];
    // Skip benched models, but a fully benched chain still runs (last resort).
    const healthy = candidates.filter((m) => !m || !isBenched(m));
    const chain = healthy.length ? healthy : candidates;
    const headers = new Headers(init?.headers);
    headers.delete('content-length');

    let lastResponse = null;
    let lastError = null;
    for (let i = 0; i < chain.length; i++) {
      const body = chain[i] ? rewriteBody(baseBody, chain[i]) : baseBody;
      try {
        const response = await inner(url, { ...init, headers, body });
        if (
          chat &&
          response.status === 200 &&
          !meta.stream &&
          (response.headers.get('content-type') || '').includes('application/json')
        ) {
          const probe = await response.clone().text();
          let parsed = null;
          try {
            parsed = JSON.parse(probe);
          } catch (_e) {
            // not chat JSON — treat as a normal success
          }
          if (parsed && isEmptyChat200(parsed)) {
            recordFailure(chain[i], cfg);
            logger.warn(
              `[gatewayFailover] gateway returned an empty chat completion on ${chain[i]}` +
                (chain[i + 1] ? `, retrying with ${chain[i + 1]}` : ', no retry left'),
            );
            lastResponse = response;
            continue;
          }
        }
        if (!isRetryable(response.status, chat)) {
          if (chat) {
            recordSuccess(chain[i]);
          }
          return response;
        }
        recordFailure(chain[i], cfg);
        lastResponse = response;
        logger.warn(
          `[gatewayFailover] gateway returned ${response.status} on ${chain[i] || url.pathname}` +
            (chain[i + 1] ? `, retrying with ${chain[i + 1]}` : ', no retry left'),
        );
      } catch (e) {
        recordFailure(chain[i], cfg);
        lastError = e;
        logger.warn(
          `[gatewayFailover] gateway request failed on ${chain[i] || url.pathname}: ${e?.message}` +
            (chain[i + 1] ? `, retrying with ${chain[i + 1]}` : ', no retry left'),
        );
      }
    }
    if (lastResponse) {
      return lastResponse;
    }
    throw lastError;
  };
}

/** Installs the wrapper on global fetch once. No-op without OPRAIZ_BASEURL. */
function installGatewayFailover() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  const base = process.env.OPRAIZ_BASEURL;
  if (!base) {
    return;
  }
  // The base config is cached indefinitely app-wide; chains change with a
  // restart, like the rest of the YAML config.
  let cfgPromise;
  const getCfg = async () => {
    if (!cfgPromise) {
      // Lazy require: keeps the config service out of unit tests of this module.
      cfgPromise = require('~/server/services/Config')
        .getAppConfig({ baseOnly: true })
        .then((config) => config?.failover)
        .catch((e) => {
          logger.warn(`[gatewayFailover] failed to load failover config, using defaults: ${e.message}`);
          return undefined;
        });
    }
    return cfgPromise;
  };
  globalThis.fetch = wrapGatewayFetch(globalThis.fetch, base, getCfg);
  logger.info('[gatewayFailover] armed for the Opraiz gateway');
}

/** Test-only: clears the health tracker between suites. */
function resetGatewayHealth() {
  health.clear();
}

module.exports = {
  installGatewayFailover,
  wrapGatewayFetch,
  chatChain,
  resetGatewayHealth,
  isEmptyChat200,
};
