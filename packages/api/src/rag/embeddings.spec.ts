/**
 * The ingest-side embedder's contract, exercised against substitute providers.
 *
 * The substitutes stand in for the one thing a test cannot own — a network
 * provider — and every other part of the run (batching, the pool, the timeout,
 * the ordered assembly) is the real implementation. The failure cases are the
 * point of the file: a provider that is slow, wrong, or dishonest has to come
 * back as a *reportable* absence of vectors, never as a rejected write and never
 * as a vector attached to the wrong chunk.
 */
import type { ChunkEmbedder, EmbedDegradation } from './embeddings';
import { embedChunks, EMBED_REMEDY } from './embeddings';

const run = (texts: string[], embedder: ChunkEmbedder, overrides = {}) =>
  embedChunks({
    texts,
    embedder,
    batchSize: 64,
    concurrency: 2,
    timeoutMs: 1_000,
    ...overrides,
  });

/** One distinct, finite, 3-dimension vector per input, so a shift is visible. */
const unitVector = (text: string): number[] => [text.length, 1, 0];

const echoing: ChunkEmbedder = {
  embed: async (texts) => texts.map(unitVector),
};

describe('embedChunks', () => {
  describe('a healthy provider', () => {
    it('returns one vector per text, in the order the texts were sent', async () => {
      const result = await run(['alpha', 'bb', 'cccc'], echoing);

      expect(result.vectors).toEqual([
        [5, 1, 0],
        [2, 1, 0],
        [4, 1, 0],
      ]);
      expect(result.embedded).toBe(3);
      expect(result.degraded).toBeUndefined();
    });

    /**
     * Absence is the success report, not the failure one. A caller that only
     * checked for a truthy `embedding` report on the response would otherwise be
     * unable to tell a fully embedded document from one the embedder was never
     * asked about.
     */
    it('reports no degradation when every text got a vector', async () => {
      expect(await run(['alpha'], echoing)).not.toHaveProperty('degraded');
    });

    it('returns nothing at all for no texts, without calling the provider', async () => {
      const embed = jest.fn(echoing.embed);

      const result = await run([], { embed });

      expect(result).toEqual({ vectors: [], embedded: 0 });
      expect(embed).not.toHaveBeenCalled();
    });
  });

  describe('batching', () => {
    it('sends one call per batch rather than one per text', async () => {
      const embed = jest.fn(echoing.embed);

      await run(['a', 'bb', 'ccc', 'dddd', 'eeeee'], { embed }, { batchSize: 2 });

      expect(embed).toHaveBeenCalledTimes(3);
      expect(embed.mock.calls.map(([texts]) => texts)).toEqual([
        ['a', 'bb'],
        ['ccc', 'dddd'],
        ['eeeee'],
      ]);
    });

    it('pairs every vector back to its own text across batch boundaries', async () => {
      // The reason order is the whole contract: a run that zipped batches
      // together rather than by index would silently attach `bb`'s vector to `a`.
      const result = await run(['a', 'bb', 'ccc', 'dddd', 'eeeee'], echoing, { batchSize: 2 });

      expect(result.vectors).toEqual([
        [1, 1, 0],
        [2, 1, 0],
        [3, 1, 0],
        [4, 1, 0],
        [5, 1, 0],
      ]);
      expect(result.embedded).toBe(5);
    });

    it('runs one text per call when the batch size is one', async () => {
      const embed = jest.fn(echoing.embed);

      await run(['a', 'b'], { embed }, { batchSize: 1 });

      expect(embed.mock.calls.map(([texts]) => texts)).toEqual([['a'], ['b']]);
    });

    /**
     * A hand-wired caller — the same caller `createRagService` defends against on
     * the chunk geometry — can pass a nonsensical lever. Zero would make the
     * batching loop below never advance.
     */
    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      'resolves a nonsensical batch size (%p) to one text per call',
      async (batchSize) => {
        const embed = jest.fn(echoing.embed);

        const result = await run(['a', 'b'], { embed }, { batchSize });

        expect(embed).toHaveBeenCalledTimes(2);
        expect(result.embedded).toBe(2);
      },
    );
  });

  describe('concurrency', () => {
    /**
     * A provider that takes its time, so the pool's high-water mark is read off a
     * real run rather than off a hand-released one. The count is decremented by
     * the call itself, which is what keeps it honest: a call abandoned by the
     * timeout would otherwise still be counted, and the pool would look like it
     * had opened more than it did.
     */
    function slow(): { embedder: ChunkEmbedder; peak: () => number } {
      let inFlight = 0;
      let high = 0;
      return {
        embedder: {
          embed: async (texts) => {
            inFlight += 1;
            high = Math.max(high, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight -= 1;
            return texts.map(unitVector);
          },
        },
        peak: () => high,
      };
    }

    it('never opens more calls at once than the configured concurrency', async () => {
      const { embedder, peak } = slow();

      const result = await run(['a', 'bb', 'ccc', 'dddd', 'eeeee', 'ffffff'], embedder, {
        batchSize: 1,
        concurrency: 2,
      });

      expect(peak()).toBe(2);
      expect(result.embedded).toBe(6);
    });

    it('opens every batch at once when the concurrency allows it', async () => {
      const { embedder, peak } = slow();

      const result = await run(['a', 'bb', 'ccc', 'dddd'], embedder, {
        batchSize: 1,
        concurrency: 8,
      });

      expect(peak()).toBe(4);
      expect(result.embedded).toBe(4);
    });

    it('never exceeds the concurrency even with more batches than workers', async () => {
      const { embedder, peak } = slow();

      await run(
        Array.from({ length: 20 }, (_unused, index) => `chunk ${index}`),
        embedder,
        {
          batchSize: 1,
          concurrency: 3,
        },
      );

      expect(peak()).toBe(3);
    });

    it('resolves a nonsensical concurrency to one call at a time', async () => {
      const { embedder, peak } = slow();

      await run(['a', 'bb', 'ccc'], embedder, { batchSize: 1, concurrency: 0 });

      expect(peak()).toBe(1);
    });
  });

  describe('the timeout', () => {
    it('abandons a batch the provider never answers and says so', async () => {
      const result = await run(
        ['alpha', 'bb'],
        { embed: () => new Promise(() => {}) },
        {
          timeoutMs: 10,
        },
      );

      expect(result.degraded).toBe<EmbedDegradation>('timed-out');
      expect(result.embedded).toBe(0);
      expect(result.vectors).toEqual([undefined, undefined]);
    });

    it('lets the healthy batches through when only one times out', async () => {
      // Mixed outcome is the realistic outage: a provider degrading under load
      // fails some calls, not all of them, and the document is still worth
      // keeping the parts that worked for.
      let call = 0;
      const flaky: ChunkEmbedder = {
        embed: async (texts) => {
          call += 1;
          if (call === 1) {
            return new Promise<number[][]>(() => {});
          }
          return texts.map(unitVector);
        },
      };

      const result = await run(['a', 'bb', 'ccc', 'dddd'], flaky, {
        batchSize: 2,
        concurrency: 1,
        timeoutMs: 10,
      });

      expect(result.degraded).toBe<EmbedDegradation>('timed-out');
      expect(result.embedded).toBe(2);
      expect(result.vectors).toEqual([undefined, undefined, [3, 1, 0], [4, 1, 0]]);
    });

    it('does not wait for the abandoned call, so the write is not held open', async () => {
      let settled = false;
      const embedder: ChunkEmbedder = {
        embed: () =>
          new Promise<number[][]>((resolve) =>
            setTimeout(() => {
              settled = true;
              resolve([[1, 0, 0]]);
            }, 500),
          ),
      };

      await run(['a'], embedder, { timeoutMs: 5 });

      expect(settled).toBe(false);
    });

    it('resolves a nonsensical timeout rather than waiting forever', async () => {
      const result = await run(['a'], { embed: () => new Promise(() => {}) }, { timeoutMs: 0 });

      expect(result.degraded).toBe<EmbedDegradation>('timed-out');
    });
  });

  /**
   * The three ways a provider can be wrong rather than slow. Every one of them
   * used to be invisible: a stub that returned zero vectors looked exactly like a
   * wired-up embedder that found nothing, and nothing downstream could tell the
   * difference until a query came back empty.
   */
  describe('a provider that is wrong rather than slow', () => {
    it('reports a rejected call as failed and still returns every slot', async () => {
      const result = await run(['a', 'bb'], {
        embed: () => Promise.reject(new Error('401 unauthorized')),
      });

      expect(result.degraded).toBe<EmbedDegradation>('failed');
      expect(result.embedded).toBe(0);
      expect(result.vectors).toEqual([undefined, undefined]);
    });

    it('reports a synchronous throw as failed rather than propagating it', async () => {
      // A provider that throws before returning a promise must not take the
      // ingest down with it: the write is the caller's, not the embedder's.
      const result = await run(['a'], {
        embed: () => {
          throw new Error('SDK not configured');
        },
      });

      expect(result.degraded).toBe<EmbedDegradation>('failed');
    });

    it('reports a short answer as misaligned and stores none of it', async () => {
      // The dangerous case: three texts, two vectors. Matching the first two
      // positionally would be a guess, and a wrong guess attaches a real vector
      // to the wrong chunk — worse than no vector, because it cannot be detected.
      const result = await run(['a', 'bb', 'ccc'], {
        embed: async () => [
          [1, 0, 0],
          [2, 0, 0],
        ],
      });

      expect(result.degraded).toBe<EmbedDegradation>('misaligned');
      expect(result.embedded).toBe(0);
      expect(result.vectors).toEqual([undefined, undefined, undefined]);
    });

    it('reports a long answer as misaligned too', async () => {
      const result = await run(['a'], {
        embed: async () => [
          [1, 0, 0],
          [2, 0, 0],
        ],
      });

      expect(result.degraded).toBe<EmbedDegradation>('misaligned');
    });

    it.each([
      ['an empty vector', [] as number[]],
      ['a vector of nulls', [Number.NaN, 0, 0]],
      ['a vector of infinities', [Number.POSITIVE_INFINITY, 0, 0]],
    ])('reports %s as unusable and drops only that slot', async (_label, bad) => {
      const result = await run(['a', 'bb'], {
        embed: async (texts) => texts.map((text, index) => (index === 0 ? bad : unitVector(text))),
      });

      expect(result.degraded).toBe<EmbedDegradation>('unusable');
      expect(result.embedded).toBe(1);
      expect(result.vectors).toEqual([undefined, [2, 1, 0]]);
    });

    it('drops a vector whose length differs from the rest of the run', async () => {
      // A provider reconfigured mid-run still looks wired: every chunk carries a
      // vector, and every cosine against the odd one is `0` on the length
      // mismatch. Refusing it here is where that is still visible.
      const result = await run(['a', 'bb', 'ccc'], {
        embed: async (texts) =>
          texts.map((text, index) => (index === 1 ? [1, 2, 3, 4] : unitVector(text))),
      });

      expect(result.degraded).toBe<EmbedDegradation>('unusable');
      expect(result.embedded).toBe(2);
      expect(result.vectors).toEqual([[1, 1, 0], undefined, [3, 1, 0]]);
    });

    it('keeps the first dimension it sees, whichever batch it arrives in', async () => {
      const result = await run(['a', 'bb', 'ccc', 'dddd'], {
        embed: async (texts) => texts.map((text) => (text === 'a' ? [1, 0] : [1, 0, 0, 0])),
      });

      expect(result.embedded).toBe(1);
      expect(result.degraded).toBe<EmbedDegradation>('unusable');
      expect(result.vectors[0]).toEqual([1, 0]);
    });

    it('reports an empty answer for a non-empty request as misaligned', async () => {
      const result = await run(['a'], { embed: async () => [] });

      expect(result.degraded).toBe<EmbedDegradation>('misaligned');
    });

    it('names the first failing batch, so the report is deterministic', async () => {
      // Concurrency would otherwise decide which reason a caller is told, and two
      // identical ingests could report different ones.
      const result = await run(
        ['a', 'bb', 'ccc', 'dddd', 'eeeee', 'ffffff'],
        {
          embed: async (texts) => {
            if (texts[0] === 'a') {
              return new Promise<number[][]>(() => {});
            }
            if (texts[0] === 'ccc') {
              throw new Error('rate limited');
            }
            return texts.map(unitVector);
          },
        },
        { batchSize: 1, concurrency: 1, timeoutMs: 10 },
      );

      expect(result.degraded).toBe<EmbedDegradation>('timed-out');
    });
  });

  describe('EMBED_REMEDY', () => {
    it('names an action for every reason a run can report', () => {
      const reasons: EmbedDegradation[] = ['timed-out', 'failed', 'misaligned', 'unusable'];

      for (const reason of reasons) {
        expect(EMBED_REMEDY[reason]).toBeTruthy();
      }
    });

    it('points a timeout at the lever that bounds it', () => {
      expect(EMBED_REMEDY['timed-out']).toContain('embeddingTimeoutMs');
    });
  });
});
