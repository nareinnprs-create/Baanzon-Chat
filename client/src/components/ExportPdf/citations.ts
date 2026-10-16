import type { TOptions } from 'i18next';
import {
  Tools,
  type SearchResultData,
  type TAttachment,
  type TMessage,
} from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { CLEANUP_REGEX, STANDALONE_PATTERN } from '~/utils/citations';
import type {
  CitationAnchor,
  ExportCitation,
  ExportDocument,
  ExportMessage,
  ExportPdfScope,
  SearchResultsByTurn,
} from './types';

type Localize = (key: TranslationKeys, options?: TOptions) => string;

/**
 * Same ref-type mapping the renderer uses (`components/Web/Context.tsx`), kept
 * here so an exported `[n]` resolves to the identical source the reader sees.
 * `image`/`video` are intentionally absent: the renderer's map omits them too,
 * so those anchors resolve to nothing and are dropped on both surfaces.
 */
const REF_TYPE_MAP: Record<string, string> = {
  search: 'organic',
  ref: 'references',
  news: 'topStories',
  file: 'references',
};

/**
 * The `file_search` attachment is typed as {@link SearchResultData} but the
 * agent tool emits `{ sources }` at runtime — mirror of the renderer's reader.
 */
interface FileSource {
  fileId: string;
  fileName: string;
  pages?: number[];
  relevance?: number;
  pageRelevance?: Record<string, number>;
  metadata?: unknown;
}
type FileSearchAttachmentData = SearchResultData & { sources?: FileSource[] };

/**
 * Pure equivalent of `useSearchResultsByTurn` (a hook, so it cannot run once per
 * message in a loop). Builds the turn -> SearchResultData map the citation
 * resolver reads, including the file-search pseudo-turn assignment.
 */
export function buildSearchResultsByTurn(
  attachments: TAttachment[] | undefined,
  localize: Localize,
): SearchResultsByTurn {
  const turnMap: SearchResultsByTurn = {};
  let agentFileSearchTurn = 0;

  attachments?.forEach((attachment) => {
    if (attachment.type === Tools.web_search && attachment[Tools.web_search]) {
      const searchData = attachment[Tools.web_search];
      if (searchData && typeof searchData.turn === 'number') {
        turnMap[searchData.turn.toString()] = searchData;
      }
    }

    if (attachment.type === Tools.file_search && attachment[Tools.file_search]) {
      const sources = (attachment[Tools.file_search] as FileSearchAttachmentData).sources;
      const list = Array.isArray(sources) ? sources : [];
      turnMap[agentFileSearchTurn.toString()] = {
        turn: agentFileSearchTurn,
        organic: [],
        topStories: [],
        images: [],
        references: list.map((source) => ({
          title: source.fileName || localize('com_file_unknown'),
          link: `#file-${source.fileId}`,
          attribution: source.fileName || localize('com_file_unknown'),
          snippet:
            source.pages && source.pages.length > 0
              ? localize('com_file_pages', { pages: source.pages.join(', ') })
              : '',
          type: 'file' as const,
          fileId: source.fileId,
          fileName: source.fileName,
          pages: source.pages ?? [],
        })) as SearchResultData['references'],
      };
      agentFileSearchTurn++;
    }
  });

  return turnMap;
}

/** Resolve one parsed anchor against the message's search results. */
export function resolveCitationAnchor(
  anchor: CitationAnchor,
  results: SearchResultsByTurn,
): ExportCitation | undefined {
  const mapped = REF_TYPE_MAP[anchor.refType.toLowerCase()] ?? anchor.refType;
  const bucket = results[anchor.turn]?.[mapped as keyof SearchResultData];
  if (!Array.isArray(bucket)) {
    return undefined;
  }
  const source = bucket[anchor.index] as Record<string, unknown> | undefined;
  if (!source) {
    return undefined;
  }
  return {
    index: anchor.index,
    title: typeof source.title === 'string' ? source.title : '',
    link: typeof source.link === 'string' ? source.link : '',
    snippet: typeof source.snippet === 'string' ? source.snippet : '',
    attribution: typeof source.attribution === 'string' ? source.attribution : '',
    fileId: typeof source.fileId === 'string' ? source.fileId : undefined,
    fileName: typeof source.fileName === 'string' ? source.fileName : undefined,
    type: typeof source.type === 'string' ? source.type : undefined,
  };
}

type Segment = { kind: 'text'; value: string } | { kind: 'anchor'; anchor: CitationAnchor };

/**
 * Split raw message text into literal text (with citation marker characters
 * stripped, but highlight text kept) and parsed anchors. The regexes live in
 * `~/utils/citations`; fresh `g` instances are created here because a shared
 * stateful `lastIndex` would skip matches between calls.
 */
export function tokenizeMessageText(raw: string): Segment[] {
  const anchors = new RegExp(STANDALONE_PATTERN.source, 'g');
  const strip = new RegExp(CLEANUP_REGEX.source, 'g');
  const segments: Segment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = anchors.exec(raw)) !== null) {
    if (match.index > cursor) {
      const text = raw.slice(cursor, match.index).replace(strip, '');
      if (text) {
        segments.push({ kind: 'text', value: text });
      }
    }
    segments.push({
      kind: 'anchor',
      anchor: { turn: Number(match[1]), refType: match[2], index: Number(match[3]) },
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < raw.length) {
    const text = raw.slice(cursor).replace(strip, '');
    if (text) {
      segments.push({ kind: 'text', value: text });
    }
  }

  return segments;
}

function senderLabel(message: TMessage, localize: Localize): string {
  if (message.isCreatedByUser) {
    return localize('com_ui_user');
  }
  return message.sender || localize('com_ui_assistant');
}

function formatTimestamp(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toLocaleString();
}

/**
 * Reduce a message to its printable form. Inline anchors become `[n]` markers
 * numbered against a de-duplicated source list, so a reader can match the text
 * to the citations that follow it.
 */
export function buildExportMessage(message: TMessage, localize: Localize): ExportMessage {
  const results = buildSearchResultsByTurn(message.attachments, localize);
  const citations: ExportCitation[] = [];
  const numberBySource = new Map<string, number>();
  let text = '';

  for (const segment of tokenizeMessageText(message.text ?? '')) {
    if (segment.kind === 'text') {
      text += segment.value;
      continue;
    }
    const citation = resolveCitationAnchor(segment.anchor, results);
    if (!citation) {
      continue;
    }
    const key = `${citation.link}::${citation.title}::${citation.fileId ?? ''}`;
    let number = numberBySource.get(key);
    if (number == null) {
      number = citations.length + 1;
      numberBySource.set(key, number);
      citations.push({ ...citation, index: number });
    }
    text += `[${number}]`;
  }

  return {
    id: message.messageId ?? '',
    sender: senderLabel(message, localize),
    createdAt: formatTimestamp(message.createdAt),
    text,
    citations,
    error: message.error === true,
  };
}

/**
 * Walk `parentMessageId` from a leaf back to the root so only the branch the
 * reader is looking at is printed, not sibling regenerations. Falls back to the
 * input order when the linkage is missing.
 */
export function linearizeThread(messages: TMessage[]): TMessage[] {
  if (messages.length <= 1) {
    return messages;
  }
  const byId = new Map<string, TMessage>();
  messages.forEach((message) => {
    if (message.messageId) {
      byId.set(message.messageId, message);
    }
  });
  const parentIds = new Set<string>();
  messages.forEach((message) => {
    if (message.parentMessageId) {
      parentIds.add(message.parentMessageId);
    }
  });

  let leaf: TMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.messageId && !parentIds.has(message.messageId)) {
      leaf = message;
      break;
    }
  }
  leaf = leaf ?? messages[messages.length - 1];

  const chain: TMessage[] = [];
  const seen = new Set<string>();
  let current: TMessage | undefined = leaf;
  while (current) {
    const id = current.messageId ?? '';
    if (id && seen.has(id)) {
      break;
    }
    if (id) {
      seen.add(id);
    }
    chain.push(current);
    current = current.parentMessageId ? byId.get(current.parentMessageId) : undefined;
  }

  return chain.reverse();
}

export type BuildExportDocumentParams = {
  messages: TMessage[];
  scope: ExportPdfScope;
  selectedMessageId?: string | null;
  title: string;
  localize: Localize;
  now?: Date;
};

/** Build the printable document for the chosen scope. Pure. */
export function buildExportDocument({
  messages,
  scope,
  selectedMessageId,
  title,
  localize,
  now = new Date(),
}: BuildExportDocumentParams): ExportDocument {
  const selected =
    scope === 'message'
      ? messages.filter((message) => message.messageId === selectedMessageId)
      : linearizeThread(messages);

  return {
    title,
    exportedAt: now.toLocaleString(),
    scope,
    messages: selected.map((message) => buildExportMessage(message, localize)),
  };
}
