import { createOpenAIEmbeddings } from './openaiEmbeddings';

/** A `fetch` stand-in returning one canned JSON payload. */
function fetchReturning(payload: unknown, ok = true, status = 200) {
  return jest.fn(async () => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  })) as unknown as typeof fetch;
}

const BASE = { baseURL: 'https://provider.example/v1', apiKey: 'secret', model: 'm' };

describe('createOpenAIEmbeddings', () => {
  it('posts to `<baseURL>/embeddings` with the bearer token and model', async () => {
    const fetchImpl = fetchReturning({ data: [{ embedding: [1, 2, 3] }] });
    const { chunkEmbedder } = createOpenAIEmbeddings({ ...BASE, dimension: 3, fetchImpl });

    await chunkEmbedder.embed(['hello']);

    const [url, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe('https://provider.example/v1/embeddings');
    expect(init.headers.Authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body)).toEqual({ model: 'm', input: ['hello'] });
  });

  it('strips a trailing slash so the path never doubles up', async () => {
    const fetchImpl = fetchReturning({ data: [{ embedding: [1] }] });
    const { chunkEmbedder } = createOpenAIEmbeddings({
      ...BASE,
      baseURL: 'https://provider.example/v1/',
      dimension: 1,
      fetchImpl,
    });

    await chunkEmbedder.embed(['x']);

    expect((fetchImpl as unknown as jest.Mock).mock.calls[0][0]).toBe(
      'https://provider.example/v1/embeddings',
    );
  });

  it('returns one vector per input, restoring order from a numeric index', async () => {
    const fetchImpl = fetchReturning({
      data: [
        { index: 1, embedding: [9, 9] },
        { index: 0, embedding: [1, 1] },
      ],
    });
    const { chunkEmbedder } = createOpenAIEmbeddings({ ...BASE, dimension: 2, fetchImpl });

    await expect(chunkEmbedder.embed(['a', 'b'])).resolves.toEqual([
      [1, 1],
      [9, 9],
    ]);
  });

  it('short-circuits an empty batch without touching the network', async () => {
    const fetchImpl = fetchReturning({ data: [] });
    const { chunkEmbedder } = createOpenAIEmbeddings({ ...BASE, dimension: 2, fetchImpl });

    await expect(chunkEmbedder.embed([])).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws, naming the status, on a non-2xx response', async () => {
    const fetchImpl = fetchReturning({ error: 'nope' }, false, 429);
    const { chunkEmbedder } = createOpenAIEmbeddings({ ...BASE, dimension: 2, fetchImpl });

    await expect(chunkEmbedder.embed(['a'])).rejects.toThrow(/429/);
  });

  it('refuses a batch whose vector count does not match the input count', async () => {
    const fetchImpl = fetchReturning({ data: [{ embedding: [1, 2] }] });
    const { chunkEmbedder } = createOpenAIEmbeddings({ ...BASE, dimension: 2, fetchImpl });

    await expect(chunkEmbedder.embed(['a', 'b'])).rejects.toThrow(/1 vector/);
  });

  it('exposes a single-text query embedder with the configured dimension', async () => {
    const fetchImpl = fetchReturning({ data: [{ embedding: [4, 5, 6] }] });
    const { queryEmbedder } = createOpenAIEmbeddings({ ...BASE, dimension: 3, fetchImpl });

    expect(queryEmbedder.dimension).toBe(3);
    await expect(queryEmbedder.embed('q')).resolves.toEqual([4, 5, 6]);
  });

  it('throws when a query comes back without a usable vector', async () => {
    const fetchImpl = fetchReturning({ data: [] });
    const { queryEmbedder } = createOpenAIEmbeddings({ ...BASE, dimension: 3, fetchImpl });

    await expect(queryEmbedder.embed('q')).rejects.toThrow(/0 vector/);
  });
});
