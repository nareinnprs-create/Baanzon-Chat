const {
  wrapGatewayFetch,
  chatChain,
  resetGatewayHealth,
  isEmptyChat200,
} = require('./gatewayFailover');

const GW = 'https://gateway.example.com/client/v4/accounts/acct/ai/v1';

function gatewayUrl(path) {
  return `${GW}/${path}`;
}

const okBody = (model) =>
  JSON.stringify({ id: 'x', model, choices: [{ message: { content: 'ok' } }] });

/**
 * Scripted mock: array entries are numbers (respond with that status and body
 * "boom"), errors (throw), null (200 success echoing the request's model),
 * or { empty: true } (200 application/json chat body with no content).
 */
function makeInner(responses) {
  const calls = [];
  const inner = async (url, init) => {
    calls.push({ url: String(url), body: init?.body });
    const next = responses[calls.length - 1];
    if (next === null) {
      // No explicit content-type: mimics a plain success the empty-200 probe
      // skips (the probe only inspects application/json bodies).
      return new Response(okBody(JSON.parse(init?.body || '{}').model || ''), { status: 200 });
    }
    if (next && next.empty) {
      return new Response(JSON.stringify({ id: 'x', choices: [{ message: { content: '' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (typeof next === 'number') {
      return new Response('boom', { status: next });
    }
    throw next;
  };
  inner.calls = calls;
  return inner;
}

describe('gateway failover', () => {
  beforeEach(() => {
    resetGatewayHealth();
  });

  it('chains primary, its approved alternates and the FALLBACK tail', () => {
    expect(chatChain('@cf/zai-org/glm-5.3')).toEqual([
      '@cf/zai-org/glm-5.3',
      '@cf/zai-org/glm-4.7-flash',
      '@cf/openai/gpt-oss-20b',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/openai/gpt-oss-120b',
      '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
    ]);
    expect(chatChain('@cf/zai-org/glm-4.7-flash')).toEqual([
      '@cf/zai-org/glm-4.7-flash',
      '@cf/openai/gpt-oss-20b',
      '@cf/zai-org/glm-5.3',
      '@cf/meta/llama-3.2-3b-instruct',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    ]);
  });

  it('uses the configured chain for a model when one is set', () => {
    const cfg = { chains: { '@cf/zai-org/glm-5.3': ['@cf/openai/gpt-oss-120b'] } };
    expect(chatChain('@cf/zai-org/glm-5.3', cfg)).toEqual([
      '@cf/zai-org/glm-5.3',
      '@cf/openai/gpt-oss-120b',
    ]);
  });

  it('uses defaultChain for models without their own entry', () => {
    const cfg = { defaultChain: ['@cf/openai/gpt-oss-120b'] };
    expect(chatChain('@cf/mistralai/anything', cfg)).toEqual([
      '@cf/mistralai/anything',
      '@cf/openai/gpt-oss-120b',
    ]);
    // ...and a model-specific chain still wins over defaultChain.
    expect(
      chatChain('@cf/zai-org/glm-5.3', {
        ...cfg,
        chains: { '@cf/zai-org/glm-5.3': ['@cf/zai-org/glm-4.7-flash'] },
      }),
    ).toEqual(['@cf/zai-org/glm-5.3', '@cf/zai-org/glm-4.7-flash']);
  });

  it('retries a failed chat request with the next model in the chain', async () => {
    const inner = makeInner([500, null]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ model: '@cf/zai-org/glm-4.7-flash' });
    expect(inner.calls).toHaveLength(2);
    expect(JSON.parse(inner.calls[1].body).model).toBe('@cf/zai-org/glm-4.7-flash');
  });

  it('retries a 403 (entitlement) by swapping the model', async () => {
    const inner = makeInner([403, null]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(inner.calls).toHaveLength(2);
    expect(JSON.parse(inner.calls[1].body).model).toBe('@cf/zai-org/glm-4.7-flash');
  });

  it('retries a 410 (deprecated model) by swapping the model', async () => {
    const inner = makeInner([410, null]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(inner.calls).toHaveLength(2);
  });

  it('retries an empty chat 200 with the next model', async () => {
    const inner = makeInner([{ empty: true }, null]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(inner.calls).toHaveLength(2);
    expect(JSON.parse(inner.calls[1].body).model).toBe('@cf/zai-org/glm-4.7-flash');
    expect(await res.json()).toMatchObject({ model: '@cf/zai-org/glm-4.7-flash' });
  });

  it('returns the last response when even the final attempt is an empty 200', async () => {
    const inner = makeInner([500, { empty: true }]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/mistralai/only-one', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(inner.calls).toHaveLength(2);
  });

  it('does not run the empty-200 probe on streamed chat requests', async () => {
    const inner = makeInner([{ empty: true }]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3', stream: true, messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(inner.calls).toHaveLength(1);
  });

  it('benches a model after threshold consecutive failures and skips it later', async () => {
    const cfg = { failureThreshold: 2, cooldownMs: 60000 };
    const inner = makeInner([500, null, 500, null, null]);
    const fetcher = wrapGatewayFetch(inner, GW, () => cfg);

    // Request 1: glm-5.3 fails once, deepseek-v4-flash succeeds.
    await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3', messages: [] }),
    });
    expect(JSON.parse(inner.calls[0].body).model).toBe('@cf/zai-org/glm-5.3');

    // Request 2: glm-5.3 fails a second time -> benched.
    await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3', messages: [] }),
    });

    // Request 3: glm-5.3 is benched -> chain starts at deepseek-v4-flash.
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(inner.calls[2].body).model).toBe('@cf/zai-org/glm-5.3'); // 2nd failure
    expect(JSON.parse(inner.calls[3].body).model).toBe('@cf/zai-org/glm-4.7-flash'); // its retry
    expect(JSON.parse(inner.calls[4].body).model).toBe('@cf/zai-org/glm-4.7-flash'); // benched skip
  });

  it('clears the failure counter after a success', async () => {
    const cfg = { failureThreshold: 2 };
    const inner = makeInner([500, null, null, 500, null]);
    const fetcher = wrapGatewayFetch(inner, GW, () => cfg);

    // Request 1: glm-5.3 fails (count 1), deepseek-v4-flash succeeds.
    await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3', messages: [] }),
    });
    // Request 2: glm-5.3 succeeds -> counter cleared.
    await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3', messages: [] }),
    });
    // Request 3: glm-5.3 is still first (never benched).
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(inner.calls[2].body).model).toBe('@cf/zai-org/glm-5.3'); // request 2
    expect(JSON.parse(inner.calls[3].body).model).toBe('@cf/zai-org/glm-5.3'); // request 3 primary
  });

  it('puts a benched model back in service after cooldownMs', async () => {
    const cfg = { failureThreshold: 1, cooldownMs: 50 };
    const inner = makeInner([500, null, null, null]);
    const fetcher = wrapGatewayFetch(inner, GW, () => cfg);

    // Request 1: glm-5.3 fails -> benched for 50ms.
    await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3', messages: [] }),
    });
    // Request 2: glm-5.3 skipped.
    await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3', messages: [] }),
    });
    expect(JSON.parse(inner.calls[2].body).model).toBe('@cf/zai-org/glm-4.7-flash');

    await new Promise((r) => setTimeout(r, 60));
    // Request 3: cooldown expired -> glm-5.3 tried again.
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(inner.calls[3].body).model).toBe('@cf/zai-org/glm-5.3');
  });

  it('still runs a fully benched chain as a last resort', async () => {
    const cfg = { failureThreshold: 1, cooldownMs: 60000 };
    const inner = makeInner([500, 500, 500, 500, 500, 500, null]);
    const fetcher = wrapGatewayFetch(inner, GW, () => cfg);

    // Request 1: every model in the chain fails -> all benched.
    await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3', messages: [] }),
    });
    expect(inner.calls).toHaveLength(6);

    // Request 2: nothing healthy -> the original chain runs anyway.
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(inner.calls[6].body).model).toBe('@cf/zai-org/glm-5.3');
  });

  it('resolves a public model key before the first send', async () => {
    const inner = makeInner([null]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: 'baanzon-flash', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(inner.calls).toHaveLength(1);
    expect(JSON.parse(inner.calls[0].body).model).toBe('@cf/zai-org/glm-4.7-flash');
    expect(await res.json()).toMatchObject({ model: '@cf/zai-org/glm-4.7-flash' });
  });

  it('chains from the resolved model when a public key fails', async () => {
    const inner = makeInner([400, null]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: 'baanzon-flash', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(inner.calls).toHaveLength(2);
    expect(JSON.parse(inner.calls[0].body).model).toBe('@cf/zai-org/glm-4.7-flash');
    expect(JSON.parse(inner.calls[1].body).model).toBe('@cf/openai/gpt-oss-20b');
  });

  it('still retries an unknown non-@cf model with the same body', async () => {
    const inner = makeInner([400, null]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: 'mystery-model', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(inner.calls).toHaveLength(2);
    expect(JSON.parse(inner.calls[1].body).model).toBe('mystery-model');
  });

  it('chains through the approved alternates after repeated failures', async () => {
    const inner = makeInner([500, 503, null]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/openai/gpt-oss-120b' }),
    });
    expect(res.status).toBe(200);
    expect(inner.calls).toHaveLength(3);
    expect(JSON.parse(inner.calls[2].body).model).toBe('@cf/deepseek-ai/deepseek-v4.1-flash-1017');
  });

  it('returns the last response when the whole chain fails', async () => {
    const inner = makeInner([500, 500, 500, 500, 500, 500]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3', messages: [] }),
    });
    expect(res.status).toBe(500);
    expect(inner.calls).toHaveLength(6);
  });

  it('retries non-chat gateway calls with the same body', async () => {
    const inner = makeInner([503, null]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('embeddings'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/baai/bge-m3', input: 'hi' }),
    });
    expect(res.status).toBe(200);
    expect(inner.calls).toHaveLength(2);
    expect(JSON.parse(inner.calls[1].body).model).toBe('@cf/baai/bge-m3');
  });

  it('does not retry a 4xx that is not 400/403/404/410/429', async () => {
    const inner = makeInner([401, null]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3' }),
    });
    expect(res.status).toBe(401);
    expect(inner.calls).toHaveLength(1);
  });

  it('retries a 404 (catalog drift) by swapping the model', async () => {
    const inner = makeInner([404, null]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3' }),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(inner.calls[1].body).model).toBe('@cf/zai-org/glm-4.7-flash');
  });

  it('leaves requests outside the gateway untouched', async () => {
    const inner = makeInner([500, null]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher('https://other.example.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3' }),
    });
    expect(res.status).toBe(500);
    expect(inner.calls).toHaveLength(1);
  });

  it('retries a network error', async () => {
    const inner = makeInner([new Error('ECONNRESET'), null]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3' }),
    });
    expect(res.status).toBe(200);
    expect(inner.calls).toHaveLength(2);
  });

  it('passes through stream bodies without retry', async () => {
    const inner = makeInner([500, null]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const stream = new ReadableStream();
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: stream,
    });
    expect(res.status).toBe(500);
    expect(inner.calls).toHaveLength(1);
  });

  describe('isEmptyChat200', () => {
    it('flags bodies without usable chat content', () => {
      expect(isEmptyChat200({ choices: [{ message: { content: '' } }] })).toBe(true);
      expect(isEmptyChat200({ choices: [{ message: { content: '   ' } }] })).toBe(true);
      expect(isEmptyChat200({ choices: [{ message: {} }] })).toBe(true);
      expect(isEmptyChat200({})).toBe(true);
    });

    it('accepts content, tool calls and reasoning as usable output', () => {
      expect(isEmptyChat200({ choices: [{ message: { content: 'ok' } }] })).toBe(false);
      expect(isEmptyChat200({ choices: [{ message: { tool_calls: [{ id: 't' }] } }] })).toBe(false);
      expect(isEmptyChat200({ choices: [{ message: { reasoning: 'thinking' } }] })).toBe(false);
      expect(isEmptyChat200({ choices: [{ message: { reasoning_content: 'thinking' } }] })).toBe(
        false,
      );
    });
  });
});
