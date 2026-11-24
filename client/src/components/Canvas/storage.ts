import type { CanvasComment, CanvasDocument, CanvasVersion } from './types';

/**
 * Local persistence for the Canvas workspace.
 *
 * The feature ships without a backend, so without this every reload, tab
 * switch or PWA restart silently threw away the document, its comments and its
 * version history. The snapshot is a small, versioned JSON blob; anything that
 * fails validation is ignored (a stale or hand-edited entry must never crash
 * the page).
 */

const SNAPSHOT_VERSION = 1;

export type CanvasSnapshot = {
  document: CanvasDocument;
  comments: CanvasComment[];
  versions: CanvasVersion[];
};

type StoredSnapshot = CanvasSnapshot & { version: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDocument(value: unknown): value is CanvasDocument {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string') {
    return false;
  }
  return (
    Array.isArray(value.blocks) &&
    value.blocks.every(
      (block) =>
        isRecord(block) &&
        typeof block.id === 'string' &&
        typeof block.kind === 'string' &&
        typeof block.text === 'string',
    )
  );
}

function isVersion(value: unknown): value is CanvasVersion {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.createdAt === 'string' &&
    isDocument(value.document)
  );
}

function isComment(value: unknown): value is CanvasComment {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.blockId === 'string' &&
    typeof value.body === 'string' &&
    typeof value.author === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.resolved === 'boolean'
  );
}

/** Reads a stored snapshot, or `null` when there is none or it is unusable. */
export function loadCanvasSnapshot(key: string): CanvasSnapshot | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== SNAPSHOT_VERSION || !isDocument(parsed.document)) {
    return null;
  }
  const comments = Array.isArray(parsed.comments) ? parsed.comments.filter(isComment) : [];
  const versions = Array.isArray(parsed.versions) ? parsed.versions.filter(isVersion) : [];
  return { document: parsed.document, comments, versions };
}

/** Writes a snapshot. Storage failures (quota, private mode) are non-fatal. */
export function saveCanvasSnapshot(key: string, snapshot: CanvasSnapshot): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  const stored: StoredSnapshot = { version: SNAPSHOT_VERSION, ...snapshot };
  try {
    localStorage.setItem(key, JSON.stringify(stored));
  } catch {
    /* Nothing the user can do about a full or blocked storage. */
  }
}
