/**
 * Shared types for the Canvas workspace.
 *
 * The workspace is deliberately backend-agnostic: the editor calls an injected
 * `editSelection` function that returns {@link CanvasEditOperation}s, and the
 * workspace applies them to the document through the pure reducer in
 * `./state`. These types are the only vocabulary the view, the reducer and a
 * backend adapter share.
 */

/** The available block flavours a document is composed of. */
export type CanvasBlockKind = 'paragraph' | 'heading' | 'quote' | 'code';

/** One unit of editable content. Blocks are ordered and identified. */
export type CanvasBlock = {
  id: string;
  kind: CanvasBlockKind;
  text: string;
};

/** A canvas document: a titled, ordered list of blocks. */
export type CanvasDocument = {
  id: string;
  title: string;
  blocks: CanvasBlock[];
  /** ISO timestamp supplied by the loader; omitted when the reducer creates one. */
  updatedAt?: string;
};

/** A character range the user highlighted inside a single block. */
export type CanvasAnchor = {
  start: number;
  end: number;
  /** The selected substring, captured so consumers need not re-slice. */
  text: string;
};

/** An anchor bound to the block it was taken from. */
export type CanvasSelection = CanvasAnchor & {
  blockId: string;
};

/** An immutable snapshot of a document, captured on demand. */
export type CanvasVersion = {
  id: string;
  label: string;
  createdAt: string;
  document: CanvasDocument;
};

/** A review note, anchored to a selection or left at document level. */
export type CanvasComment = {
  id: string;
  blockId: string;
  anchor: CanvasAnchor | null;
  body: string;
  author: string;
  createdAt: string;
  resolved: boolean;
};

/**
 * A single, self-describing mutation produced by an AI edit (or any external
 * producer). Every operation names the block it touches and carries the ids or
 * ranges it needs, so the reducer never has to invent an id for someone else's
 * content.
 */
export type CanvasEditOperation =
  | { type: 'replace_selection'; blockId: string; start: number; end: number; text: string }
  | { type: 'insert_text'; blockId: string; at: number; text: string }
  | { type: 'replace_block'; blockId: string; text: string }
  | { type: 'set_block_kind'; blockId: string; kind: CanvasBlockKind }
  | { type: 'insert_block'; index: number; block: CanvasBlock }
  | { type: 'remove_block'; blockId: string }
  | { type: 'set_title'; title: string };

/** A block-level diff between two documents, used for the version summary line. */
export type CanvasVersionDiff = {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
};
