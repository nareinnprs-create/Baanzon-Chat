const { OllamaClient } = require('../OllamaClient');

const createFetchResponse = (overrides = {}) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: { get: () => null },
  json: async () => ({}),
  text: async () => '',
  ...overrides,
});

const jsonHeaders = {
  get: (key) => (key.toLowerCase() === 'content-type' ? 'application/json' : null),
};

describe('OllamaClient', () => {
  const originalFetch = global.fetch;
  let fetchMock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const buildClient = () => new OllamaClient({ baseURL: 'http://localhost:11434' });

  const payloadFor = (overrides = {}) => ({
    model: 'llama2',
    messages: [{ role: 'user', content: 'Hello' }],
    stream: false,
    temperature: 0.5,
    ...overrides,
  });

  describe('chatCompletion - non-streaming (generate)', () => {
    it('parses the response and POSTs a flattened prompt to /api/generate', async () => {
      fetchMock.mockResolvedValue(
        createFetchResponse({ json: async () => ({ response: 'Hello, world!' }) }),
      );

      const onProgress = jest.fn();
      const result = await buildClient().chatCompletion({
        payload: payloadFor({
          messages: [
            { role: 'system', content: 'be nice' },
            { role: 'user', content: 'Hello' },
          ],
        }),
        onProgress,
      });

      expect(result).toBe('Hello, world!');
      expect(onProgress).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:11434/api/generate');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.headers.Accept).toBe('application/json');
      expect(init.headers['User-Agent']).toMatch(/^ollama-js\//);

      expect(JSON.parse(init.body)).toEqual({
        model: 'llama2',
        stream: false,
        temperature: 0.5,
        prompt: 'be nice\nHello',
      });
    });

    it('flattens base64 images from OpenAI-style content parts into the request', async () => {
      fetchMock.mockResolvedValue(
        createFetchResponse({ json: async () => ({ response: 'described' }) }),
      );

      const result = await buildClient().chatCompletion({
        payload: payloadFor({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'describe' },
                { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
              ],
            },
          ],
        }),
        onProgress: jest.fn(),
      });

      expect(result).toBe('described');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.prompt).toBe('describe');
      expect(body.images).toEqual(['AAAA']);
    });

    it('throws the Ollama ResponseError with the server status on a non-2xx response', async () => {
      fetchMock.mockResolvedValue(
        createFetchResponse({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: jsonHeaders,
          json: async () => ({ error: 'model not found' }),
        }),
      );

      await expect(
        buildClient().chatCompletion({ payload: payloadFor(), onProgress: jest.fn() }),
      ).rejects.toMatchObject({
        name: 'ResponseError',
        message: 'model not found',
        status_code: 500,
      });
    });

    it('falls back to the status line when a non-2xx body is not JSON', async () => {
      fetchMock.mockResolvedValue(
        createFetchResponse({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          headers: { get: () => 'text/plain' },
          text: async () => '',
        }),
      );

      await expect(
        buildClient().chatCompletion({ payload: payloadFor(), onProgress: jest.fn() }),
      ).rejects.toMatchObject({
        name: 'ResponseError',
        message: 'Error 503: Service Unavailable',
        status_code: 503,
      });
    });

    it('propagates a JSON parse failure when the response body is malformed', async () => {
      fetchMock.mockResolvedValue(
        createFetchResponse({
          json: async () => {
            throw new SyntaxError('Unexpected token < in JSON at position 0');
          },
        }),
      );

      await expect(
        buildClient().chatCompletion({ payload: payloadFor(), onProgress: jest.fn() }),
      ).rejects.toThrow(SyntaxError);
    });

    it('issues the non-stream request without an abort signal', async () => {
      fetchMock.mockResolvedValue(
        createFetchResponse({ json: async () => ({ response: 'done' }) }),
      );

      const abortController = new AbortController();
      abortController.abort();

      const result = await buildClient().chatCompletion({
        payload: payloadFor(),
        onProgress: jest.fn(),
        abortController,
      });

      expect(result).toBe('done');
      expect(fetchMock.mock.calls[0][1].signal).toBeUndefined();
    });

    it('rethrows provider errors unchanged to the caller', async () => {
      const providerError = new Error('ECONNREFUSED 127.0.0.1:11434');
      fetchMock.mockRejectedValue(providerError);

      await expect(
        buildClient().chatCompletion({ payload: payloadFor(), onProgress: jest.fn() }),
      ).rejects.toBe(providerError);
    });
  });
});
