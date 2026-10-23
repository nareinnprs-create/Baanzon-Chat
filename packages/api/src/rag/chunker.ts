/**
 * Pure text chunking for the RAG domain (blueprint §24).
 * Character-based with overlap; provider-agnostic.
 */

/** Non-global on purpose: `test` must not carry `lastIndex` between calls. */
const WHITESPACE = /\s/;

export interface ChunkResult {
  /** Chunk content: the source span with surrounding whitespace removed. */
  text: string;
  /** 0-based chunk index within the document. */
  index: number;
  /**
   * Offset of `text[0]` in the source, i.e. the *post-trim* offset:
   * `text.slice(start, start + chunk.text.length) === chunk.text` holds for
   * every chunk.
   */
  start: number;
}

/** Last whitespace offset within `[from, to]`, or -1 when there is none. */
function lastWhitespaceIn(text: string, from: number, to: number): number {
  for (let i = to; i >= from; i -= 1) {
    if (WHITESPACE.test(text[i])) {
      return i;
    }
  }
  return -1;
}

/**
 * Split `text` into overlapping character chunks.
 * - Whitespace-aware on both ends, and on any whitespace — tab- and
 *   newline-delimited sources (JSON, markdown, TSV) split as tidily as
 *   space-delimited ones. Chunk ends back up to the last whitespace in the
 *   chunk's second half and resume points advance to the next one, so a chunk
 *   rarely starts mid-token. A token longer than `chunkSize / 2` offers no
 *   boundary to snap to, and keeping the text wins over keeping the boundary.
 * - Each search is bounded to the span of the chunk being cut, so ingest cost
 *   stays linear in the document: an unbounded `indexOf` from the resume point
 *   rescans the whole tail on every iteration of a whitespace-poor document.
 * - Overlap is capped at `floor(chunkSize / 2)`.
 * - `start` is the offset of the first character of `text`, after trimming.
 * - Returns `[]` for empty input.
 */
export function chunkText(text: string, chunkSize: number, chunkOverlap: number): ChunkResult[] {
  if (chunkSize <= 0) {
    throw new Error(`chunkSize must be > 0; received ${chunkSize}`);
  }
  if (text.length === 0) {
    return [];
  }

  const overlap = Math.max(0, Math.min(chunkOverlap, Math.floor(chunkSize / 2)));
  const out: ChunkResult[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      /** Only whitespace in the chunk's second half is worth snapping to: a
       *  boundary before `mid` would cut the chunk below half its size. */
      const mid = start + Math.floor(chunkSize / 2);
      const ws = lastWhitespaceIn(text, mid + 1, end - 1);
      if (ws !== -1) {
        end = ws;
      }
    }

    const span = text.slice(start, end);
    const chunk = span.trim();
    if (chunk.length > 0) {
      /* Report where `text` itself begins. The pre-trim offset is off by the
       * leading whitespace run, so `source.slice(c.start, ...)` lands on a
       * space for most chunks and locates nothing. */
      out.push({ text: chunk, index, start: start + (span.length - span.trimStart().length) });
      index += 1;
    }

    if (end >= text.length) {
      break;
    }
    if (overlap <= 0) {
      start = end;
      continue;
    }
    /** `end` was snapped back to whitespace, so a fixed rewind from it resumes
     *  mid-word. Snap forward to the next whitespace — but only within the span
     *  this chunk already covers: whitespace past `end` is discarded, and
     *  snapping to it would skip the straddling word entirely. A word longer
     *  than `chunkSize / 2` has no boundary to snap to, and losing the tidiness
     *  is the correct trade against losing the text. The search is bounded to
     *  `end` so a whitespace-poor document cannot rescan its tail every step. */
    const target = Math.max(start + 1, end - overlap);
    const nextSpace = text.slice(target, end + 1).search(WHITESPACE);
    start = nextSpace === -1 ? target : target + nextSpace + 1;
  }

  return out;
}
