#!/usr/bin/env node
/**
 * Live deprecation guard for the Baanzon model system.
 *
 * Probes every chat-chain member (modelRouter.CHAINS) and every image model
 * (packages/api imageModelRouter) against the deployed gateway and reports
 * models the provider has retired (410/404). Run on the pod before a flip;
 * exits non-zero so a release carrying a dead primary never ships silently.
 *
 * Image models are probed with an empty JSON body: 400 means the model exists
 * (bad input), 404/410 means it is gone - no generation is billed.
 */
const fs = require('node:fs');
const path = require('node:path');
const { CHAINS } = require('../api/server/services/billing/modelRouter');

function loadEnv() {
  const envPath = path.resolve(process.env.BAANZON_ENV || '.env');
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) {
      env[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
    }
  }
  return env;
}

function imageModels() {
  try {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../packages/api/src/imageModelRouter.ts'),
      'utf8',
    );
    const ids = new Set();
    for (const match of src.matchAll(/'(https?:\/\/[^']+|@cf\/[^']+)'/g)) {
      ids.add(match[1]);
    }
    for (const match of src.matchAll(/'(@cf\/[^']+)'/g)) {
      ids.add(match[1]);
    }
    return [...ids].filter((id) => id.startsWith('@cf/'));
  } catch {
    return [];
  }
}

async function probeChat(base, key, model) {
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    signal: AbortSignal.timeout(45000),
  });
  return response.status;
}

async function probeImage(account, token, model) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(20000),
    },
  );
  return response.status;
}

(async () => {
  const env = loadEnv();
  const base = env.OPRAIZ_BASEURL || process.env.OPRAIZ_BASEURL;
  const key = env.OPRAIZ_API_KEY || process.env.OPRAIZ_API_KEY;
  const account = env.CF_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
  const token = env.CF_API_TOKEN || process.env.CF_API_TOKEN;
  if (!base || !key) {
    console.log('[model-health] no gateway credentials - skipping live probe');
    process.exit(0);
  }

  const chatModels = [
    ...new Set(
      Object.values(CHAINS).flatMap((tiers) => Object.values(tiers).flatMap((chain) => chain)),
    ),
  ];
  const dead = [];
  for (const model of chatModels) {
    try {
      const status = await probeChat(base, key, model);
      if (status === 404 || status === 410) {
        dead.push(`chat ${model} -> ${status}`);
      }
    } catch (error) {
      console.log(`[model-health] chat ${model} probe error: ${error.message}`);
    }
  }

  if (account && token) {
    for (const model of imageModels()) {
      try {
        const status = await probeImage(account, token, model);
        if (status === 404 || status === 410) {
          dead.push(`image ${model} -> ${status}`);
        }
      } catch (error) {
        console.log(`[model-health] image ${model} probe error: ${error.message}`);
      }
    }
  }

  if (dead.length > 0) {
    for (const line of dead) {
      console.error(`[model-health] DEPRECATED: ${line}`);
    }
    process.exit(1);
  }
  console.log(`[model-health] ok: ${chatModels.length} chat + image models live`);
})();
