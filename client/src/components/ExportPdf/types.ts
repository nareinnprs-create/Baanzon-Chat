import type { SearchResultData } from 'librechat-data-provider';

/**
 * What the reader asked to print: the whole (active) conversation, or one
 * message picked from it.
 */
export type ExportPdfScope = 'conversation' | 'message';

/**
 * Lifecycle of a print run. `preparing` and `printing` both disable the export
 * control; `empty` and `error` are terminal and expose a retry.
 */
export type ExportPdfStatus = 'idle' | 'preparing' | 'printing' | 'success' | 'empty' | 'error';

/** A resolved citation, numbered the way it appears inline in the printed text. */
export type ExportCitation = {
  /** 1-based number as printed in the body (`[1]`) and the sources list. */
  index: number;
  title: string;
  link: string;
  snippet: string;
  attribution: string;
  fileId?: string;
  fileName?: string;
  type?: string;
};

/** One printable message: body text with inline `[n]` markers plus its sources. */
export type ExportMessage = {
  id: string;
  sender: string;
  createdAt?: string;
  text: string;
  citations: ExportCitation[];
  error?: boolean;
};

/** The whole printable document, built once and handed to the print portal. */
export type ExportDocument = {
  title: string;
  exportedAt: string;
  scope: ExportPdfScope;
  messages: ExportMessage[];
};

/** A parsed `\ue202turn{n}{type}{index}` reference before it is resolved. */
export type CitationAnchor = {
  turn: number;
  refType: string;
  index: number;
};

/** Turn number to the same shape the renderer feeds `useCitation`. */
export type SearchResultsByTurn = Record<string, SearchResultData>;
