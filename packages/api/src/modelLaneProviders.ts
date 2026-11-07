/** Provider clients for non-chat capability lanes. No lane falls back to chat. */

export interface OpenAICompatibleChatOptions {
  baseURL: string;
  apiKey?: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export interface ChatCompletionInput {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

export interface ChatCompletionClient {
  complete(
    messages: ChatCompletionInput[],
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<string>;
}

export interface OpenAICompatibleRerankerOptions {
  baseURL: string;
  apiKey?: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export interface RerankInput {
  query: string;
  documents: string[];
  topN?: number;
}

export interface RerankResult {
  index: number;
  score: number;
}

function endpoint(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${path}`;
}

async function jsonResponse(response: Response, name: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`[model-lane:${name}] provider returned HTTP ${response.status}`);
  }
  return response.json();
}

/** OpenAI-compatible local completion client. The caller must supply an endpoint and model. */
export function createLocalChatClient(options: OpenAICompatibleChatOptions): ChatCompletionClient {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    async complete(messages, settings = {}) {
      const payload = await jsonResponse(
        await doFetch(endpoint(options.baseURL, 'chat/completions'), {
          method: 'POST',
          headers: {
            ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            messages,
            ...(settings.temperature == null ? {} : { temperature: settings.temperature }),
            ...(settings.maxTokens == null ? {} : { max_tokens: settings.maxTokens }),
          }),
        }),
        'local',
      );
      const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
        .choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('[model-lane:local] provider response has no text completion');
      }
      return content;
    },
  };
}

/** OpenAI-compatible rerank client (Cohere/Jina-style `/rerank` response). */
export function createRerankerClient(options: OpenAICompatibleRerankerOptions) {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    async rerank({ query, documents, topN }: RerankInput): Promise<RerankResult[]> {
      const payload = await jsonResponse(
        await doFetch(endpoint(options.baseURL, 'rerank'), {
          method: 'POST',
          headers: {
            ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            query,
            documents,
            ...(topN == null ? {} : { top_n: topN }),
          }),
        }),
        'reranker',
      );
      const results = (payload as { results?: unknown }).results;
      if (!Array.isArray(results)) {
        throw new Error('[model-lane:reranker] provider response has no results array');
      }
      return results.map((result) => {
        const item = result as { index?: unknown; relevance_score?: unknown; score?: unknown };
        if (
          !Number.isInteger(item.index) ||
          typeof (item.relevance_score ?? item.score) !== 'number'
        ) {
          throw new Error('[model-lane:reranker] provider returned an invalid result');
        }
        return {
          index: item.index as number,
          score: (item.relevance_score ?? item.score) as number,
        };
      });
    },
  };
}
