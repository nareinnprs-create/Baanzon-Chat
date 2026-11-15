import { attachCloudflareVisionRunFetch } from './cloudflareVisionRun';

const RED_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const UNIVERSAL_BASE = 'https://api.cloudflare.com/client/v4/accounts/acct123/ai/v1';

const imageBody = (model = '@cf/meta/llama-3.2-11b-vision-instruct') =>
  JSON.stringify({
    model,
    stream: false,
    messages: [
      { role: 'system', content: 'You are helpful.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What color?' },
          { type: 'image_url', image_url: { url: RED_PNG_DATA_URI } },
        ],
      },
    ],
  });

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('attachCloudflareVisionRunFetch', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('leaves non-CF base URLs untouched', () => {
    const configOptions: Record<string, unknown> = { baseURL: 'https://example.com/v1' };
    attachCloudflareVisionRunFetch(configOptions);
    expect(configOptions.fetch).toBeUndefined();
  });

  it('attaches a fetch for CF universal endpoints', () => {
    const configOptions: Record<string, unknown> = { baseURL: UNIVERSAL_BASE };
    attachCloudflareVisionRunFetch(configOptions);
    expect(typeof configOptions.fetch).toBe('function');
  });

  it('passes requests without image parts straight through', async () => {
    const passthrough = jest.fn().mockResolvedValue(jsonResponse({ ok: true }));
    jest.spyOn(global, 'fetch').mockImplementation(passthrough);
    const configOptions: Record<string, unknown> = { baseURL: UNIVERSAL_BASE };
    attachCloudflareVisionRunFetch(configOptions);
    const fetchFn = configOptions.fetch as typeof fetch;
    const body = JSON.stringify({ model: '@cf/meta/llama-3.1-8b-instruct-fp8', messages: [] });
    await fetchFn(`${UNIVERSAL_BASE}/chat/completions`, { method: 'POST', body });
    expect(passthrough).toHaveBeenCalledWith(`${UNIVERSAL_BASE}/chat/completions`, {
      method: 'POST',
      body,
    });
  });

  it('rewrites image requests to /ai/run and translates the completion envelope', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        result: {
          response: 'Red.',
          tool_calls: [],
          usage: { prompt_tokens: 1619, completion_tokens: 3, total_tokens: 1622 },
        },
        success: true,
      }),
    );
    const configOptions: Record<string, unknown> = { baseURL: UNIVERSAL_BASE };
    attachCloudflareVisionRunFetch(configOptions);
    const fetchFn = configOptions.fetch as typeof fetch;
    const res = await fetchFn(`${UNIVERSAL_BASE}/chat/completions`, {
      method: 'POST',
      body: imageBody(),
    });
    expect(global.fetch).toHaveBeenCalledWith(
      `https://api.cloudflare.com/client/v4/accounts/acct123/ai/run/${encodeURIComponent(
        '@cf/meta/llama-3.2-11b-vision-instruct',
      )}`,
      expect.objectContaining({ method: 'POST', body: imageBody() }),
    );
    const completion = await res.json();
    expect(completion.object).toBe('chat.completion');
    expect(completion.choices[0].message).toEqual({ role: 'assistant', content: 'Red.' });
    expect(completion.choices[0].finish_reason).toBe('stop');
    expect(completion.usage.total_tokens).toBe(1622);
  });

  it('translates run SSE chunks to OpenAI deltas and appends [DONE]', async () => {
    const sse = [
      'data: {"response":"","usage":{"prompt_tokens":1654,"completion_tokens":1}}',
      'data: {"response":"Blue","usage":{"prompt_tokens":0,"completion_tokens":5}}',
      'data: {"response":".","usage":{"prompt_tokens":0,"completion_tokens":6}}',
      '',
      '',
    ].join('\n');
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(sse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    const configOptions: Record<string, unknown> = { baseURL: UNIVERSAL_BASE };
    attachCloudflareVisionRunFetch(configOptions);
    const fetchFn = configOptions.fetch as typeof fetch;
    const body = imageBody();
    const res = await fetchFn(`${UNIVERSAL_BASE}/chat/completions`, {
      method: 'POST',
      body,
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    const events = text
      .split('\n\n')
      .filter(Boolean)
      .map((line) => {
        const payload = line.slice(5).trim();
        return payload === '[DONE]' ? '[DONE]' : JSON.parse(payload);
      });
    expect(events.filter((e) => e !== '[DONE]')).toHaveLength(3);
    expect(events[0]).toMatchObject({
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content: '' } }],
    });
    expect(events[1].choices[0].delta).toEqual({ content: 'Blue' });
    expect(events[1].usage.completion_tokens).toBe(5);
    expect(events[events.length - 1]).toBe('[DONE]');
  });

  it('passes provider errors through untranslated', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ errors: [{ message: 'boom' }] }), { status: 500 }),
      );
    const configOptions: Record<string, unknown> = { baseURL: UNIVERSAL_BASE };
    attachCloudflareVisionRunFetch(configOptions);
    const fetchFn = configOptions.fetch as typeof fetch;
    const res = await fetchFn(`${UNIVERSAL_BASE}/chat/completions`, {
      method: 'POST',
      body: imageBody(),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.errors[0].message).toBe('boom');
  });
});
