/**
 * Embeddings adapter for any OpenAI-compatible `/embeddings` endpoint.
 *
 * This is the concrete provider the ingest side (`ChunkEmbedder`) and the
 * retrieval side (`EmbeddingsProvider`) both wait for, so that semantic search
 * can be wired without either module learning what a provider is. It talks
 * plain HTTP through an injected `fetch` and imports no SDK, logger or storage
 * engine, which keeps the RAG domain provider-agnostic per the module-boundary
 * rule.
 *
 * The two interfaces it satisfies are deliberately *not* interchangeable —
 * `./embeddings` embeds a batch of chunks at ingest time, `./semanticSearch`
 * embeds one query at retrieval time — so the factory returns them as two named
 * members rather than one overloaded `embed`:
 *
 *  - `chunkEmbedder: ChunkEmbedder` — `embed(texts: string[]): Promise<number[][]>`,
 *    one vector per input, order preserved. Pass this to `embedChunks`.
 *  - `queryEmbedder: EmbeddingsProvider` — `readonly dimension` and
 *    `embed(text: string): Promise<number[]>`. Pass this to
 *    `createSemanticSearchService`.
 */

import type { ChunkEmbedder } from './embeddings';
import type { EmbeddingsProvider } from './semanticSearch';

/** Everything the adapter needs to reach a provider; all injected by the caller. */
export interface OpenAIEmbeddingsOptions {
  /** Provider root, e.g. `https://api.openai.com/v1`; `/embeddings` is appended. */
  baseURL: string;
  /** Bearer token sent as `Authorization: Bearer <apiKey>`. */
  apiKey: string;
  /** Provider model id, e.g. `text-embedding-3-small`. */
  model: string;
  /** Vector length the provider is configured to return. */
  dimension: number;
  /** Fetch implementation; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * The two embedder shapes the rest of the package consumes. They are kept apart
 * on purpose: a single-text provider fed a batch would embed one chunk and drop
 * the rest, and a batch embedder fed one query would return a nested array the
 * cosine scorer cannot use.
 */
export interface OpenAIEmbeddings {
  /** Ingest-side: batch, order-preserving. Give to `embedChunks`. */
  chunkEmbedder: ChunkEmbedder;
  /** Retrieval-side: one text in, one vector out. Give to the semantic service. */
  queryEmbedder: EmbeddingsProvider;
}

/** One element of an OpenAI-compatible `data` array. */
interface RawEmbeddingEntry {
  index?: unknown;
  embedding?: unknown;
}

/** Provider root without a trailing slash, so `/embeddings` never doubles up. */
function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** A short, single-line excerpt of an error body — enough to diagnose, no dump. */
function bodySnippet(body: string): string {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  return collapsed.length > 200 ? `${collapsed.slice(0, 200)}…` : collapsed;
}

/**
 * Turn a provider payload into ordered vectors, or throw.
 *
 * The count is the load-bearing check: a vector attached to the wrong chunk is
 * worse than none, so a response that is short or long is refused outright
 * rather than matched up positionally. A numeric `index`, when present, is
 * honoured to restore the requested order before the count is trusted; entries
 * with no index are assumed to arrive in input order, as OpenAI documents.
 */
function parseEmbeddings(payload: unknown, expected: number): number[][] {
  const data =
    payload != null && typeof payload === 'object'
      ? (payload as { data?: unknown }).data
      : undefined;
  if (!Array.isArray(data)) {
    throw new Error('[rag:openai-embeddings] response has no `data` array');
  }
  if (data.length !== expected) {
    throw new Error(
      `[rag:openai-embeddings] response carried ${data.length} vector(s) for ${expected} input(s)`,
    );
  }

  const entries = data as RawEmbeddingEntry[];
  const indexed = entries.every((entry) => typeof entry.index === 'number');
  const ordered = indexed
    ? [...entries].sort((a, b) => (a.index as number) - (b.index as number))
    : entries;

  let dimension = 0;
  return ordered.map((entry, position) => {
    const embedding = entry.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error(`[rag:openai-embeddings] vector at position ${position} is missing or empty`);
    }
    for (const value of embedding) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(
          `[rag:openai-embeddings] vector at position ${position} carries a non-finite value`,
        );
      }
    }
    const vector = embedding as number[];
    if (dimension === 0) {
      dimension = vector.length;
    }
    if (vector.length !== dimension) {
      throw new Error(
        `[rag:openai-embeddings] vector at position ${position} has length ${vector.length}, expected ${dimension}`,
      );
    }
    return vector;
  });
}

/**
 * Build both embedders over one OpenAI-compatible endpoint.
 *
 * The returned object is documented above: `chunkEmbedder` for ingest,
 * `queryEmbedder` for retrieval. An empty batch short-circuits before the
 * network; a single query that comes back without a usable vector throws, since
 * there is no batch to degrade and a silent `[]` would score every candidate
 * `0`. Non-2xx responses throw with the status and a short body excerpt.
 */
export function createOpenAIEmbeddings(options: OpenAIEmbeddingsOptions): OpenAIEmbeddings {
  const doFetch = options.fetchImpl ?? fetch;
  const url = `${withoutTrailingSlash(options.baseURL)}/embeddings`;

  async function request(texts: string[]): Promise<number[][]> {
    const response = await doFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: options.model, input: texts }),
    });

    if (!response.ok) {
      let snippet = '';
      try {
        snippet = bodySnippet(await response.text());
      } catch {
        snippet = '';
      }
      throw new Error(
        `[rag:openai-embeddings] embeddings request failed with status ${response.status}${
          response.statusText ? ` ${response.statusText}` : ''
        }${snippet ? `: ${snippet}` : ''}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error('[rag:openai-embeddings] response was not valid JSON');
    }
    return parseEmbeddings(payload, texts.length);
  }

  const chunkEmbedder: ChunkEmbedder = {
    async embed(texts) {
      if (texts.length === 0) {
        return [];
      }
      return request(texts);
    },
  };

  const queryEmbedder: EmbeddingsProvider = {
    dimension: options.dimension,
    async embed(text) {
      const vectors = await request([text]);
      const [vector] = vectors;
      if (vector == null) {
        throw new Error('[rag:openai-embeddings] response carried no vector for the query');
      }
      return vector;
    },
  };

  return { chunkEmbedder, queryEmbedder };
}
