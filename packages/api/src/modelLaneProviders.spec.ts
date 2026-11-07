import { createLocalChatClient, createRerankerClient } from './modelLaneProviders';

const response = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;

describe('model lane providers', () => {
  it('uses the configured local endpoint and supports multimodal message content', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(response({ choices: [{ message: { content: 'local answer' } }] }));
    const client = createLocalChatClient({
      baseURL: 'http://localhost:11434/v1/',
      model: 'llava',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      client.complete([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe this' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
          ],
        },
      ]),
    ).resolves.toBe('local answer');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:11434/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('parses reranker results and rejects malformed provider responses', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response({ results: [{ index: 1, relevance_score: 0.9 }] }))
      .mockResolvedValueOnce(response({ results: [{ index: 'bad', score: 0.2 }] }));
    const client = createRerankerClient({
      baseURL: 'https://rank.example',
      model: 'ranker',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.rerank({ query: 'q', documents: ['a', 'b'] })).resolves.toEqual([
      { index: 1, score: 0.9 },
    ]);
    await expect(client.rerank({ query: 'q', documents: ['a'] })).rejects.toThrow('invalid result');
  });
});
