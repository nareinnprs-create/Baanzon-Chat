import type { ChunkResult } from './chunker';
import { chunkText } from './chunker';

/** Unique text at every offset, so a slice identifies its own position. */
const NUMBERED = Array.from({ length: 200 }, (_unused, i) => `word${i}`).join(' ');

/** No whitespace at all: every boundary is exact, so offsets are predictable. */
const DENSE = 'x'.repeat(200);

function allChunksText(chunks: ChunkResult[]): string[] {
  return chunks.map((c) => c.text);
}

describe('chunkText', () => {
  describe('regression: a chunk must be its own slice, never the whole document', () => {
    it('returns only substrings of the source, each no longer than chunkSize', () => {
      const chunks = chunkText(NUMBERED, 50, 5);

      expect(chunks.length).toBeGreaterThan(5);
      for (const c of chunks) {
        expect(NUMBERED).toContain(c.text);
        expect(c.text.length).toBeLessThanOrEqual(50);
      }
    });

    it('never emits the entire source when the source exceeds chunkSize', () => {
      const chunks = chunkText(NUMBERED, 50, 5);

      for (const c of chunks) {
        expect(c.text).not.toBe(NUMBERED);
        expect(c.text.length).toBeLessThan(NUMBERED.length);
      }
    });

    it('emits pairwise-distinct chunks', () => {
      const chunks = chunkText(NUMBERED, 50, 5);

      const distinct = new Set(allChunksText(chunks));
      expect(distinct.size).toBe(chunks.length);
    });

    it('never reproduces the whole document, even for a short repeating one', () => {
      const repeated = 'alpha beta gamma delta. '.repeat(30);
      const chunks = chunkText(repeated, 40, 0);

      expect(chunks.length).toBeGreaterThan(3);
      for (const c of chunks) {
        expect(c.text).not.toBe(repeated.trim());
        expect(repeated).toContain(c.text);
        expect(c.text.length).toBeLessThanOrEqual(40);
      }
    });
  });

  describe('indexes and offsets', () => {
    it('numbers chunks contiguously from zero', () => {
      const chunks = chunkText(NUMBERED, 50, 5);

      expect(chunks.map((c) => c.index)).toEqual(
        Array.from({ length: chunks.length }, (_unused, i) => i),
      );
    });

    it('reports a start offset that locates the chunk inside the source', () => {
      const chunks = chunkText(NUMBERED, 50, 5);

      for (const c of chunks) {
        expect(NUMBERED.startsWith(c.text, c.start)).toBe(true);
        expect(c.start).toBeGreaterThanOrEqual(0);
        expect(c.start).toBeLessThan(NUMBERED.length);
      }
    });

    it('reports the post-trim start, not the pre-trim one', () => {
      /* `text` is trimmed but `start` used to be the offset of the whitespace
       * the trim removed, so the documented slice located nothing. Run over a
       * geometry sweep: any chunk resuming on whitespace is a counterexample. */
      let sawTrimmed = false;
      for (let chunkSize = 4; chunkSize <= 40; chunkSize += 1) {
        for (const chunkOverlap of [0, 2, 5, 999]) {
          const text = `${'a'.repeat(chunkSize)} ${'b'.repeat(chunkSize)}  ${'c'.repeat(chunkSize)}`;
          for (const c of chunkText(text, chunkSize, chunkOverlap)) {
            expect(text.slice(c.start, c.start + c.text.length)).toBe(c.text);
            /* Pre-trim this offset was the whitespace the trim removed, so the
             * character before it is still whitespace. */
            if (c.start > 0 && /\s/.test(text[c.start - 1])) {
              sawTrimmed = true;
            }
          }
        }
      }
      /* The fixture must actually reach a trimmed leading run, or it proves
       * nothing about the fix. */
      expect(sawTrimmed).toBe(true);
    });

    it('advances the start offset monotonically', () => {
      const starts = chunkText(NUMBERED, 50, 5).map((c) => c.start);

      for (let i = 1; i < starts.length; i += 1) {
        expect(starts[i]).toBeGreaterThan(starts[i - 1]);
      }
    });

    it('carries the document through to its last character', () => {
      const chunks = chunkText(NUMBERED, 50, 5);
      const last = chunks[chunks.length - 1];

      expect(last.start + last.text.length).toBe(NUMBERED.length);
    });
  });

  describe('overlap', () => {
    it('advances by exactly chunkSize when the overlap is zero', () => {
      const chunks = chunkText(DENSE, 20, 0);

      expect(chunks.map((c) => c.start)).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 160, 180]);
    });

    it('advances by chunkSize - overlap when the overlap fits', () => {
      const chunks = chunkText(DENSE, 20, 4);

      expect(chunks.map((c) => c.start)).toEqual([
        0, 16, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192,
      ]);
    });

    it('caps the overlap at floor(chunkSize / 2) so the scan always progresses', () => {
      const chunks = chunkText(DENSE, 20, 10_000);

      const starts = chunks.map((c) => c.start);
      expect(starts[1] - starts[0]).toBe(10);
      for (let i = 1; i < starts.length; i += 1) {
        expect(starts[i] - starts[i - 1]).toBe(10);
      }
    });

    it('overlaps consecutive slices by the requested amount', () => {
      const chunks = chunkText(DENSE, 20, 6);

      const first = DENSE.slice(chunks[0].start, chunks[0].start + 20);
      const second = DENSE.slice(chunks[1].start, chunks[1].start + 20);
      expect(first.slice(-6)).toBe(second.slice(0, 6));
    });
  });

  describe('word boundaries', () => {
    it('ends every chunk on a whole word', () => {
      for (const c of chunkText(NUMBERED, 50, 5)) {
        const tokens = c.text.split(' ');
        expect(tokens[tokens.length - 1]).toMatch(/^word\d+$/);
      }
    });

    it('reports a start offset that locates the chunk text exactly', () => {
      for (const c of chunkText(NUMBERED, 50, 5)) {
        expect(NUMBERED.startsWith(c.text, c.start)).toBe(true);
      }
    });

    it('resumes each chunk on a word boundary, not mid-token', () => {
      const chunks = chunkText(NUMBERED, 50, 5);

      // The forward boundary snaps back to whitespace and the resume point snaps
      // forward to whitespace, so no chunk begins with a partial token — a
      // leading `ord5` would otherwise reach the embedding.
      const midWordStarts = chunks.filter((c) => !/^word\d+/.test(c.text));
      expect(midWordStarts).toEqual([]);
    });

    it('keeps each chunk free of leading and trailing whitespace', () => {
      for (const c of chunkText(NUMBERED, 50, 5)) {
        expect(c.text).toBe(c.text.trim());
      }
    });

    it('treats tabs and newlines as boundaries, not as token content', () => {
      /* Ingested JSON, markdown and TSV are delimited by tabs and newlines, not
       * spaces: a literal-space search finds no boundary at all there and every
       * chunk starts mid-token. */
      const sources = [
        /* Tab-delimited (TSV). */
        Array.from({ length: 20 }, (_unused, i) => `tok${i}`).join('\t'),
        /* Newline-delimited (JSONL, markdown lists). */
        Array.from({ length: 20 }, (_unused, i) => `tok${i}`).join('\n'),
        /* Alternating, as an ingest that mixes line ends and column seps. */
        Array.from({ length: 20 }, (_unused, i) => `tok${i}`)
          .map((token, i) => (i === 0 ? token : (i % 2 === 0 ? '\n' : '\t') + token))
          .join(''),
      ];

      for (const text of sources) {
        const chunks = chunkText(text, 20, 5);
        expect(chunks.length).toBeGreaterThan(2);
        for (const c of chunks) {
          /* Either the chunk is the first one, or it resumes on whitespace. */
          if (c.start > 0) {
            expect(text[c.start - 1]).toMatch(/\s/);
          }
          expect(c.text).toMatch(/^tok\d+/);
        }
      }
    });

    it('ends a chunk on a tab boundary where a space search finds none', () => {
      /* Tokens occupy 5 characters each, so `chunkSize: 22` lands two characters
       * into `eeee`; only a whitespace-aware back-snap pulls `end` out of it. */
      const text = 'aaaa\tbbbb\tcccc\tdddd\teeee\tffff\tgggg\thhhh\tiiii\tjjjj';
      const chunks = chunkText(text, 22, 5);

      expect(chunks.length).toBeGreaterThan(2);
      for (const c of chunks) {
        expect(c.text).toMatch(/(aaaa|bbbb|cccc|dddd|eeee|ffff|gggg|hhhh|iiii|jjjj)$/);
      }
    });
  });

  describe('degenerate input', () => {
    it('throws when chunkSize is zero', () => {
      expect(() => chunkText(NUMBERED, 0, 0)).toThrow('chunkSize must be > 0; received 0');
    });

    it('throws when chunkSize is negative', () => {
      expect(() => chunkText(NUMBERED, -10, 0)).toThrow(/chunkSize must be > 0/);
    });

    it('returns no chunks for an empty document', () => {
      expect(chunkText('', 100, 10)).toEqual([]);
    });

    it('returns no chunks for a whitespace-only document', () => {
      expect(chunkText('   \n\t ', 100, 10)).toEqual([]);
    });

    it('returns a single chunk for a document smaller than chunkSize', () => {
      expect(chunkText('hello world', 100, 10)).toEqual([
        { text: 'hello world', index: 0, start: 0 },
      ]);
    });

    it('treats a negative overlap as zero', () => {
      const chunks = chunkText(DENSE, 20, -5);

      expect(chunks[1].start).toBe(20);
    });
  });

  /**
   * The overlap rewind snaps forward to a word boundary. When a word is longer
   * than `chunkSize / 2` there is no boundary inside the chunk, and the next
   * whitespace lies *beyond* the current `end` — snapping to it anyway skips
   * the straddling word entirely, so the text is silently never chunked. These
   * assertions cover every offset of the source, not just that some chunks
   * exist, because a lost word produces plausible-looking output.
   *
   * Coverage is derived from the chunks the implementation returned. A helper
   * that re-walks the same geometry as the implementation cannot fail when the
   * implementation loses text, which is the whole defect being guarded.
   */
  describe('coverage', () => {
    /** Offsets the returned chunks actually account for. */
    function coveredFromChunks(text: string, chunks: ChunkResult[]): Set<number> {
      const covered = new Set<number>();
      for (const c of chunks) {
        let at = c.start;
        while (at < text.length && /\s/.test(text[at])) {
          at += 1;
        }
        /* `start` locates the chunk: if it does not, coverage is meaningless. */
        expect(text.slice(at, at + c.text.length)).toBe(c.text);
        for (let i = at; i < at + c.text.length; i += 1) {
          covered.add(i);
        }
      }
      return covered;
    }

    /** Non-whitespace offsets of `text` that no returned chunk accounts for. */
    function missingOffsets(text: string, chunks: ChunkResult[]): number[] {
      const covered = coveredFromChunks(text, chunks);
      const missing: number[] = [];
      for (let i = 0; i < text.length; i += 1) {
        if (text[i] !== ' ' && !covered.has(i)) {
          missing.push(i);
        }
      }
      return missing;
    }

    it('keeps every character of a word that straddles a chunk boundary', () => {
      const text = `${'A'.repeat(11)}${'B'.repeat(10)} ${'C'.repeat(10)}`;
      const chunks = chunkText(text, 10, 5);

      /* The regression: a naive "snap to the next space" resume starts after
       * the Bs, and they appear in no chunk. */
      expect(chunks.map((c) => c.text).join('')).toContain('B'.repeat(10));
      expect(missingOffsets(text, chunks)).toEqual([]);
    });

    it('never drops a non-whitespace character across many geometries', () => {
      for (let wordLength = 1; wordLength <= 40; wordLength += 1) {
        for (let chunkSize = 4; chunkSize <= 60; chunkSize += 1) {
          for (const chunkOverlap of [0, 3, 11, 999]) {
            const text = `${'w'.repeat(wordLength)} ${'q'.repeat(wordLength)} tail`;
            const chunks = chunkText(text, chunkSize, chunkOverlap);
            expect(chunks.length).toBeGreaterThan(0);
            expect({
              wordLength,
              chunkSize,
              chunkOverlap,
              missing: missingOffsets(text, chunks),
            }).toEqual({ wordLength, chunkSize, chunkOverlap, missing: [] });
          }
        }
      }
    });
  });
});
