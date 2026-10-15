const cors = require('cors');
const { logger } = require('@librechat/data-schemas');

/**
 * P2.5 security hardening — CORS allowlist.
 *
 * Replaces the previous wide-open `cors()`. Allowed origins are resolved from:
 *   1. BAANZON_CORS_ALLOWLIST — comma-separated origins. `*` allows every origin
 *      (logs a warning; intended only for debugging).
 *   2. DOMAIN_CLIENT          — the SPA origin (default `http://localhost:3080`).
 *   3. DOMAIN_SERVER          — the API origin.
 * The first non-empty source wins, so an explicit BAANZON_CORS_ALLOWLIST overrides
 * the domain-derived defaults.
 *
 * Same-origin requests (no `Origin` header — server-to-server, curl, and the Vite
 * dev proxy, which is same-origin to the browser) are always allowed. A present but
 * unlisted `Origin` is refused by omitting the CORS response headers, so the browser
 * blocks cross-origin reads while non-browser clients and top-level SSO navigations
 * (which also carry an `Origin`) keep working. Requests are never hard-failed here:
 * a 403 on an unlisted `Origin` would break SAML/OIDC POST callbacks.
 *
 * Credentials are enabled so cookie-authenticated cross-origin clients can be
 * allowlisted explicitly; nothing is exposed unless its origin is listed.
 */

/** Reduces any origin-ish value (`https://host:port/path`, bare host) to `scheme://host:port`. */
function normalizeOrigin(value) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === '*') {
    return '*';
  }
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    return new URL(withScheme).origin.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
}

function buildAllowlist(env) {
  const allowlist = new Set();
  const raw = env.BAANZON_CORS_ALLOWLIST;
  if (raw && raw.trim()) {
    for (const entry of raw.split(',')) {
      const origin = normalizeOrigin(entry);
      if (origin) {
        allowlist.add(origin);
      }
    }
    return allowlist;
  }

  for (const key of ['DOMAIN_CLIENT', 'DOMAIN_SERVER']) {
    const origin = normalizeOrigin(env[key]);
    if (origin) {
      allowlist.add(origin);
    }
  }
  return allowlist;
}

/**
 * Builds the CORS middleware.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {import('express').RequestHandler}
 */
function createBaanzonCors(env = process.env) {
  const allowlist = buildAllowlist(env);
  const allowAll = allowlist.has('*');
  const warned = new Set();

  if (allowAll) {
    logger.warn(
      '[CORS] BAANZON_CORS_ALLOWLIST=* — every origin is allowed. Use only for debugging.',
    );
  } else if (allowlist.size === 0) {
    logger.warn(
      '[CORS] No allowed origins resolved (BAANZON_CORS_ALLOWLIST / DOMAIN_CLIENT / ' +
        'DOMAIN_SERVER unset); cross-origin browser requests will be refused.',
    );
  } else {
    logger.info(`[CORS] Allowed origins: ${[...allowlist].join(', ')}`);
  }

  return cors({
    origin(requestOrigin, callback) {
      if (!requestOrigin || allowAll || allowlist.has(normalizeOrigin(requestOrigin))) {
        return callback(null, true);
      }
      if (!warned.has(requestOrigin)) {
        warned.add(requestOrigin);
        logger.warn(`[CORS] Refusing cross-origin browser access for origin: ${requestOrigin}`);
      }
      return callback(null, false);
    },
    credentials: true,
  });
}

module.exports = createBaanzonCors;
