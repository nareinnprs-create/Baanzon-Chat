/**
 * Gateway failover for the Opraiz gateway (Cloudflare Workers AI, the only
 * real provider). Wraps global fetch once at startup so every call site that
 * hits the gateway (agents runtime, embeddings, triggers) is covered:
 *
 * - Chat requests: primary model first every request ("always the best
 *   provider"), then on 5xx/429/404/400 or a network error rewrite the body's
 *   model to the next id in the chain (primary -> glm-4.7-flash -> FALLBACK)
 *   and retry. Retries happen before any response reaches the caller, so a
 *   consumed SSE stream is never re-run.
 * - Public model keys (e.g. the memory agent's 'baanzon-flash') resolve to
 *   their concrete @cf/ ids before the first send — the gateway rejects
 *   anything else with "No such model".
 * - Other gateway calls (embeddings etc.): retry the same body once on
 *   5xx/429/network errors — the model must not change.
 * - Non-gateway traffic passes through untouched.
 *
 * Fetch-only by design: all gateway callers use global fetch. If a caller
 * ever switches to axios, it needs its own wrapper here.
 */
const { logger } = require('@librechat/data-schemas');
const { FALLBACK, PUBLIC_MODELS } = require('../billing/modelRouter');

/** Cheap always-provisioned model, second in every chain. */
const SECONDARY = '@cf/zai-org/glm-4.7-flash';

const CHAT_RETRY_STATUS = new Set([400, 404, 429]);
const PLAIN_RETRY_STATUS = new Set([429]);

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

/** True when this init's body can be re-sent (streams cannot). */
function bodyReusable(body) {
  return (
    body == null ||
    typeof body === 'string' ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  );
}

function chatChain(model) {
  return [...new Set([model, SECONDARY, FALLBACK.model])];
}

/**
 * Returns a fetch that adds the failover behavior for the gateway origin.
 * Exported for tests; `installGatewayFailover` wires it onto global fetch.
 */
function wrapGatewayFetch(inner, gatewayBase) {
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
    const rawModel = (() => {
      try {
        return JSON.parse(init.body || '{}').model || '';
      } catch (_e) {
        return '';
      }
    })();
    // Public model keys (baanzon.yaml agent configs like the memory agent's
    // 'baanzon-flash') resolve to their concrete ids before the first send;
    // the gateway only knows @cf/ ids.
    const resolvedModel = PUBLIC_MODELS[rawModel] || rawModel;
    const baseBody = resolvedModel === rawModel ? init.body : rewriteBody(init.body, resolvedModel);
    // chat: primary -> SECONDARY -> FALLBACK (model rewritten per attempt);
    // anything else: two attempts with the same body.
    const chain =
      chat && resolvedModel.startsWith('@cf/') ? chatChain(resolvedModel) : [null, null];
    const headers = new Headers(init?.headers);
    headers.delete('content-length');

    let lastResponse = null;
    let lastError = null;
    for (let i = 0; i < chain.length; i++) {
      const body = chain[i] ? rewriteBody(baseBody, chain[i]) : baseBody;
      try {
        const response = await inner(url, { ...init, headers, body });
        if (!isRetryable(response.status, chat)) {
          return response;
        }
        lastResponse = response;
        logger.warn(
          `[gatewayFailover] gateway returned ${response.status} on ${rawModel || url.pathname}` +
            (chain[i + 1] ? `, retrying with ${chain[i + 1]}` : ', no retry left'),
        );
      } catch (e) {
        lastError = e;
        logger.warn(
          `[gatewayFailover] gateway request failed on ${rawModel || url.pathname}: ${e.message}` +
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
  globalThis.fetch = wrapGatewayFetch(globalThis.fetch, base);
  logger.info('[gatewayFailover] armed for the Opraiz gateway');
}

module.exports = { installGatewayFailover, wrapGatewayFetch, chatChain };
