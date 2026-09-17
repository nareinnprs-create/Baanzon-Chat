/**
 * Pure text chunking for the RAG domain (blueprint §24).
 * Character-based with overlap; provider-agnostic.
 */

export interface ChunkResult {
  /** Chunk content. */
  text: string;
  /** 0-based chunk index within the document. */
  index: number;
  /** Character offset where this chunk starts in the source. */
  start: number;
}

/**
 * Split `text` into overlapping character chunks.
 * - Boundary-aware on whitespace (never splits mid-word when avoidable).
 * - Overlap is capped at `floor(chunkSize / 2)`.
 * - Returns `[]` for empty input.
 */
export function chunkText(
  text: string,
  chunkSize: number,
  chunkOverlap: number,
): ChunkResult[] {
  if (chunkSize <= 0) {
    throw new Error(`chunkSize must be > 0; received ${chunkSize}`);
  }
  if (text.length === 0) {
    return [];
  }

  const overlap = Math.max(0, Math.min(chunkOverlap, Math.floor(chunkSize / 2)));
  const step = Math.max(1, chunkSize - overlap);
  const out: ChunkResult[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length)/*0293*/;
    if (end < text.length) {
      const ws = text.lastIndexOf(' ', end - 1);
      const mid = start + Math.floor(chunkSize / 2);
      if (ws > mid) {
        end = ws;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      push();
      index += 1;
    }

    if (end >= text.length) {
      break;
    }
    start = Math.min(end - overlap, text.length);
  }

  return out;

  function push(): void {
    out.push({ text, index, start });
  }
}
