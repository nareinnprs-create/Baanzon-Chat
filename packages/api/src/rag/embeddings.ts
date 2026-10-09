/**
 * Ingest-side embeddings — the seam that fills `VectorChunk.embedding`.
 *
 * The semantic half of retrieval scores a chunk against a query vector, which is
 * only possible for a chunk that *carries* one. Before this module nothing in the
 * domain produced that vector: `addDocument` wrote chunks with no `embedding`,
 * the store kept them verbatim, and `cosineSimilarity` scored every candidate
 * `0` on the length mismatch before `minScore` discarded the lot. So the seam
 * existed and was never fed, and no choice of retrieval client could have made
 * it work. This module owns the write side of that gap: the interface a caller
 * supplies, and the batching, concurrency and timeout a network call on
 * `addDocument` needs to survive a provider that is slow, flaky or absent.
 *
 * There is deliberately no provider implementation here. Which embeddings
 * backend a deployment uses is a new argument, not a new branch in shared code,
 * and choosing one is a decision this repository has not made.
 *
 * Two embedder shapes live in this package and they are not interchangeable.
 * `EmbeddingsProvider` (`./semanticSearch`) embeds one *query* per call, at
 * retrieval time. `ChunkEmbedder` embeds a *batch of chunks* per call, at ingest
 * time, because one `addDocument` of a large file produces tens or hundreds of
 * chunks and a round trip per chunk would put a network call behind every one of
 * them. A caller holding a single-text provider adapts it to this interface
 * rather than either type changing shape.
 */

/**
 * Turns chunk text into vectors, injected by the caller.
 *
 * Deliberately narrower than it could be: no dimension, no model name, no
 * batching hint. Every one of those is a fact about a *deployment's* provider,
 * and pinning any of them here would make the second provider a rewrite rather
 * than a new argument. The dimension is instead measured from the first vector
 * that arrives, so a deployment whose provider is reconfigured under it is
 * reported as inconsistent instead of quietly scoring `0` on every query.
 */
export interface ChunkEmbedder {
  /**
   * Embed `texts` and return one vector per input, **in the same order**.
   *
   * Order is the whole contract. A batch that comes back with a different number
   * of vectors, or out of order, is discarded rather than matched up
   * heuristically: a vector attached to the wrong chunk is worse than no vector
   * at all, because nothing downstream can tell it from a correct one — it
   * simply ranks the wrong text, and does so silently.
   */
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Why a batch of chunks came back without a usable vector.
 *
 * Four values rather than a boolean because each names a different thing for the
 * operator to do, and a degradation that cannot be acted on is indistinguishable
 * from a bug report.
 */
export type EmbedDegradation =
  /** No answer inside `embeddingTimeoutMs`. The bound itself may be the problem. */
  | 'timed-out'
  /** The call rejected, or the provider raised. */
  | 'failed'
  /** The provider answered with a different number of vectors than texts sent. */
  | 'misaligned'
  /**
   * The provider answered and the vectors are not usable as a corpus: empty, or
   * carrying a non-finite value, or of a length that differs from the rest of
   * this run. The last is the one that is otherwise invisible — a provider that
   * silently changes dimension still *looks* wired, and still scores `0`.
   */
  | 'unusable';

/** What one `addDocument` reports about the vectors it wrote. */
export interface EmbeddingReport {
  /** Chunks that carry an embedding. */
  embedded: number;
  /** Chunks written. */
  total: number;
  /** What stopped the rest. */
  degraded: EmbedDegradation;
}

export interface EmbedChunksOptions {
  /** The texts to embed, in the order their vectors must come back. */
  texts: readonly string[];
  embedder: ChunkEmbedder;
  /** Texts per provider call. */
  batchSize: number;
  /** Provider calls in flight at once. */
  concurrency: number;
  /** Milliseconds one provider call may take before its batch is abandoned. */
  timeoutMs: number;
}

export interface EmbedChunksResult {
  /**
   * Same length and order as the `texts` passed in. A slot is `undefined` where
   * no usable vector came back for it, so a caller can pair them positionally
   * without ever having to reason about which batch produced what.
   */
  vectors: Array<number[] | undefined>;
  /** How many slots hold a usable vector. */
  embedded: number;
  /** Absent only when every slot holds one. */
  degraded?: EmbedDegradation;
}

/** Per batch: either the vectors it returned, or why it has none. */
type BatchOutcome = { ok: true; vectors: number[][] } | { ok: false; reason: EmbedDegradation };

/**
 * The timeout's own answer, as a singleton so the race can be told apart by
 * identity. Returning a `BatchOutcome` from the timer and then testing the result
 * for "is this an array?" would flatten every timeout into `failed` — which is
 * exactly the misreport this module exists to avoid, since the two have opposite
 * remedies: one means the bound is too tight, the other that the provider is
 * broken.
 */
const TIMED_OUT = Symbol('embed-timeout');

/**
 * A lever a hand-wired caller can get wrong, resolved to something a run can use.
 *
 * The same defence `createRagService` applies to the chunk geometry: a `0` or a
 * negative would otherwise make the batching loop below either never advance or
 * run every chunk as its own call, and neither is worth a config error at the
 * cost of the write.
 */
function atLeast(value: number, floor: number): number {
  return Number.isFinite(value) && value >= floor ? Math.floor(value) : floor;
}

/** A vector the rest of a corpus can be compared against. */
function isUsableVector(vector: number[] | undefined): vector is number[] {
  if (!Array.isArray(vector) || vector.length === 0) {
    return false;
  }
  for (const value of vector) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return false;
    }
  }
  return true;
}

/**
 * One provider call, bounded by `timeoutMs`.
 *
 * The timeout is a race rather than a cancellation: the provider's own promise
 * is left to settle on its own and is dropped when it does, because an injected
 * embedder has no agreed cancellation channel and a signal invented here would
 * only be honoured by the implementations that happened to read it. What the
 * timeout buys is the guarantee that matters — an ingest cannot hang on a
 * provider that never answers.
 */
async function embedBatch(
  embedder: ChunkEmbedder,
  texts: string[],
  timeoutMs: number,
): Promise<BatchOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answered = await Promise.race<number[][] | typeof TIMED_OUT>([
      embedder.embed(texts),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
      }),
    ]);
    if (answered === TIMED_OUT) {
      return { ok: false, reason: 'timed-out' };
    }
    if (!Array.isArray(answered)) {
      return { ok: false, reason: 'failed' };
    }
    if (answered.length !== texts.length) {
      return { ok: false, reason: 'misaligned' };
    }
    return { ok: true, vectors: answered };
  } catch {
    return { ok: false, reason: 'failed' };
  } finally {
    if (timer != null) {
      clearTimeout(timer);
    }
  }
}

/**
 * Embed `texts`, bounded by the three levers, and report what came back.
 *
 * Never rejects and never throws on a provider fault: a missing, slow, broken or
 * dishonest embedder degrades to "these chunks have no vector", which is exactly
 * the state the domain was in before this module existed and the state retrieval
 * already answers correctly. Failing the write instead would turn a provider
 * outage into a refusal to ingest, over content the caller can still find by
 * keyword.
 *
 * Concurrency is a fixed pool of workers pulling batch indices off one counter,
 * so a run of 200 chunks at `batchSize: 64` is four batches and at most
 * `concurrency` of them are ever open at once. Slots are assembled afterwards in
 * a single ordered pass, which is what lets the run's vector dimension be decided
 * once — the first usable vector wins, and anything of another length is dropped
 * rather than stored to be scored as `0` on every future query.
 */
export async function embedChunks(options: EmbedChunksOptions): Promise<EmbedChunksResult> {
  const batchSize = atLeast(options.batchSize, 1);
  const concurrency = atLeast(options.concurrency, 1);
  const timeoutMs = atLeast(options.timeoutMs, 1);
  const { texts, embedder } = options;

  const batches: string[][] = [];
  for (let start = 0; start < texts.length; start += batchSize) {
    batches.push(texts.slice(start, start + batchSize));
  }

  const outcomes: BatchOutcome[] = new Array(batches.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
      for (let index = next++; index < batches.length; index = next++) {
        outcomes[index] = await embedBatch(embedder, batches[index], timeoutMs);
      }
    }),
  );

  const vectors: Array<number[] | undefined> = new Array(texts.length);
  let embedded = 0;
  let dimension = 0;
  let degraded: EmbedDegradation | undefined;
  for (let batch = 0; batch < batches.length; batch += 1) {
    const outcome = outcomes[batch];
    if (!outcome.ok) {
      degraded ??= outcome.reason;
      continue;
    }
    const base = batch * batchSize;
    for (let slot = 0; slot < outcome.vectors.length; slot += 1) {
      const vector = outcome.vectors[slot];
      if (!isUsableVector(vector)) {
        degraded ??= 'unusable';
        continue;
      }
      if (dimension === 0) {
        dimension = vector.length;
      }
      if (vector.length !== dimension) {
        degraded ??= 'unusable';
        continue;
      }
      vectors[base + slot] = vector;
      embedded += 1;
    }
  }

  return { vectors, embedded, ...(degraded != null ? { degraded } : {}) };
}

/**
 * What an operator can do about each reason. Carried next to the code so the log
 * line and the response field name the same remedy instead of leaving three
 * separate explanations of a degradation to drift apart.
 */
export const EMBED_REMEDY: Record<EmbedDegradation, string> = {
  'timed-out': 'raise `rag.embeddingTimeoutMs`, or lower `rag.embeddingBatchSize`',
  failed: 'check the injected embedder and whatever it calls upstream',
  misaligned: 'the embedder returned a different number of vectors than texts sent',
  unusable: 'the embedder returned empty, non-finite or mixed-dimension vectors',
};
