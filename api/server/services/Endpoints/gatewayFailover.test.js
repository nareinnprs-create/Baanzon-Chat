const { wrapGatewayFetch, chatChain } = require('./gatewayFailover');

const GW = 'https://gateway.example.com/client/v4/accounts/acct/ai/v1';

function gatewayUrl(path) {
  return `${GW}/${path}`;
}

const okBody = (model) =>
  JSON.stringify({ id: 'x', model, choices: [{ message: { content: 'ok' } }] });

/**
 * Scripted mock: array entries are numbers (respond with that status and body
 * "boom"), errors (throw), or null (200 success echoing the request's model).
 */
function makeInner(responses) {
  const calls = [];
  const inner = async (url, init) => {
    calls.push({ url: String(url), body: init?.body });
    const next = responses[calls.length - 1];
    if (next === null) {
      return new Response(okBody(JSON.parse(init?.body || '{}').model || ''), { status: 200 });
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
  it('chains primary, the always-on secondary and the FALLBACK model', () => {
    expect(chatChain('@cf/zai-org/glm-5.3')).toEqual([
      '@cf/zai-org/glm-5.3',
      '@cf/zai-org/glm-4.7-flash',
      '@cf/meta/llama-3.1-8b-instruct-fp8',
    ]);
    expect(chatChain('@cf/zai-org/glm-4.7-flash')).toEqual([
      '@cf/zai-org/glm-4.7-flash',
      '@cf/meta/llama-3.1-8b-instruct-fp8',
    ]);
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

  it('resolves a public model key before the first send', async () => {
    const inner = makeInner([null]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: 'baanzon-flash', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(inner.calls).toHaveLength(1);
    expect(JSON.parse(inner.calls[0].body).model).toBe('@cf/zai-org/glm-5.3-flash');
    expect(await res.json()).toMatchObject({ model: '@cf/zai-org/glm-5.3-flash' });
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
    expect(JSON.parse(inner.calls[0].body).model).toBe('@cf/zai-org/glm-5.3-flash');
    expect(JSON.parse(inner.calls[1].body).model).toBe('@cf/zai-org/glm-4.7-flash');
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

  it('falls through to the FALLBACK model after repeated failures', async () => {
    const inner = makeInner([500, 503, null]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/openai/gpt-oss-120b' }),
    });
    expect(res.status).toBe(200);
    expect(inner.calls).toHaveLength(3);
    expect(JSON.parse(inner.calls[2].body).model).toBe('@cf/meta/llama-3.1-8b-instruct-fp8');
  });

  it('returns the last response when the whole chain fails', async () => {
    const inner = makeInner([500, 500, 500]);
    const fetcher = wrapGatewayFetch(inner, GW);
    const res = await fetcher(gatewayUrl('chat/completions'), {
      method: 'POST',
      body: JSON.stringify({ model: '@cf/zai-org/glm-5.3' }),
    });
    expect(res.status).toBe(500);
    expect(inner.calls).toHaveLength(3);
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

  it('does not retry a 4xx that is not 400/404/429', async () => {
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
});
