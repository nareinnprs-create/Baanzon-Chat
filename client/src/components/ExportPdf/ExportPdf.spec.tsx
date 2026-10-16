import type { TOptions } from 'i18next';
import { render, screen } from '@testing-library/react';
import { Tools, type TAttachment, type TMessage } from 'librechat-data-provider';
import i18n from '~/locales/i18n';
import { buildExportDocument, linearizeThread, tokenizeMessageText } from './citations';
import ExportPdfDialog from './ExportPdfDialog';
import PrintDocument from './PrintDocument';

const localize = (key: string, options?: TOptions) =>
  (i18n.t as unknown as (key: string, options?: TOptions) => string)(key, options);

function makeMessage(overrides: Partial<TMessage> = {}): TMessage {
  return {
    messageId: 'm1',
    conversationId: 'c1',
    parentMessageId: 'root',
    text: 'Hello',
    isCreatedByUser: false,
    sender: 'Assistant',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    error: false,
    unfinished: false,
    ...overrides,
  } as TMessage;
}

function webSearchAttachment(organic: Array<Record<string, string>>, turn = 0): TAttachment {
  return {
    type: Tools.web_search,
    [Tools.web_search]: { turn, organic },
  } as unknown as TAttachment;
}

function fileSearchAttachment(
  sources: Array<{ fileId: string; fileName: string; pages?: number[] }>,
): TAttachment {
  return {
    type: Tools.file_search,
    [Tools.file_search]: { sources },
  } as unknown as TAttachment;
}

describe('buildExportDocument', () => {
  it('numbers inline citations and carries the resolved sources', () => {
    const message = makeMessage({
      text: 'First claim\ue202turn0search0 then second\ue202turn0search1.',
      attachments: [
        webSearchAttachment([
          { title: 'Alpha', link: 'https://alpha.test', snippet: 'alpha snippet' },
          { title: 'Beta', link: 'https://beta.test', snippet: 'beta snippet' },
        ]),
      ],
    });

    const document = buildExportDocument({
      messages: [message],
      scope: 'conversation',
      title: 'Export',
      localize,
    });

    const exported = document.messages[0];
    expect(exported.text).toBe('First claim[1] then second[2].');
    expect(exported.citations).toHaveLength(2);
    expect(exported.citations[0]).toMatchObject({
      index: 1,
      title: 'Alpha',
      link: 'https://alpha.test',
      snippet: 'alpha snippet',
    });
    expect(exported.citations[1]).toMatchObject({ index: 2, title: 'Beta' });
  });

  it('de-duplicates repeat citations to the same source', () => {
    const message = makeMessage({
      text: 'One\ue202turn0search0 two\ue202turn0search0.',
      attachments: [
        webSearchAttachment([{ title: 'Alpha', link: 'https://alpha.test', snippet: '' }]),
      ],
    });

    const document = buildExportDocument({
      messages: [message],
      scope: 'conversation',
      title: 'Export',
      localize,
    });

    expect(document.messages[0].text).toBe('One[1] two[1].');
    expect(document.messages[0].citations).toHaveLength(1);
  });

  it('resolves agent file-search sources and keeps highlight text', () => {
    const message = makeMessage({
      text: '\ue203Quoted line\ue204\ue202turn0file0',
      attachments: [fileSearchAttachment([{ fileId: 'f1', fileName: 'report.pdf', pages: [3] }])],
    });

    const document = buildExportDocument({
      messages: [message],
      scope: 'conversation',
      title: 'Export',
      localize,
    });

    const exported = document.messages[0];
    expect(exported.text).toBe('Quoted line[1]');
    expect(exported.citations[0]).toMatchObject({
      index: 1,
      title: 'report.pdf',
      link: '#file-f1',
      fileId: 'f1',
    });
  });

  it('drops anchors that have no matching source', () => {
    const message = makeMessage({ text: 'Orphan\ue202turn0search7.', attachments: [] });

    const document = buildExportDocument({
      messages: [message],
      scope: 'conversation',
      title: 'Export',
      localize,
    });

    expect(document.messages[0].text).toBe('Orphan.');
    expect(document.messages[0].citations).toHaveLength(0);
  });

  it('exports a single selected message when scope is message', () => {
    const first = makeMessage({ messageId: 'a', parentMessageId: 'root', isCreatedByUser: true });
    const second = makeMessage({ messageId: 'b', parentMessageId: 'a' });

    const document = buildExportDocument({
      messages: [first, second],
      scope: 'message',
      selectedMessageId: 'b',
      title: 'Export',
      localize,
    });

    expect(document.messages.map((message) => message.id)).toEqual(['b']);
  });

  it('returns an empty document when there is nothing to export', () => {
    const document = buildExportDocument({
      messages: [],
      scope: 'conversation',
      title: 'Export',
      localize,
    });

    expect(document.messages).toHaveLength(0);
    expect(document.exportedAt).toBeTruthy();
  });
});

describe('linearizeThread', () => {
  it('follows parent links from a leaf back to the root', () => {
    const root = makeMessage({ messageId: 'root', parentMessageId: '000' });
    const middle = makeMessage({ messageId: 'middle', parentMessageId: 'root' });
    const leaf = makeMessage({ messageId: 'leaf', parentMessageId: 'middle' });

    const ordered = linearizeThread([root, middle, leaf]).map((message) => message.messageId);
    expect(ordered).toEqual(['root', 'middle', 'leaf']);
  });

  it('prints only the active branch when a message was regenerated', () => {
    const root = makeMessage({ messageId: 'root', parentMessageId: '000' });
    const oldBranch = makeMessage({ messageId: 'old', parentMessageId: 'root' });
    const newBranch = makeMessage({ messageId: 'new', parentMessageId: 'root' });

    const ordered = linearizeThread([root, oldBranch, newBranch]).map(
      (message) => message.messageId,
    );
    expect(ordered).toEqual(['root', 'new']);
  });
});

describe('tokenizeMessageText', () => {
  it('strips highlight and group markers but keeps their text', () => {
    expect(tokenizeMessageText('\ue200\ue203Grouped\ue204\ue201\ue202turn0search0')).toEqual([
      { kind: 'text', value: 'Grouped' },
      { kind: 'anchor', anchor: { turn: 0, refType: 'search', index: 0 } },
    ]);
  });
});

describe('PrintDocument', () => {
  it('renders the inline markers and the numbered source list', () => {
    const document = buildExportDocument({
      messages: [
        makeMessage({
          text: 'Cited sentence\ue202turn0search0.',
          attachments: [
            webSearchAttachment([{ title: 'Alpha', link: 'https://alpha.test', snippet: 'snip' }]),
          ],
        }),
      ],
      scope: 'conversation',
      title: 'My Conversation',
      localize,
      now: new Date('2024-05-01T12:00:00.000Z'),
    });

    render(<PrintDocument document={document} />);

    expect(screen.getByTestId('export-print-document')).toBeInTheDocument();
    expect(screen.getByText(/Cited sentence\[1\]\./)).toBeInTheDocument();
    const sources = screen.getByTestId('export-print-sources');
    expect(sources).toBeInTheDocument();
    const link = screen.getByText('Alpha').closest('a');
    expect(link).toHaveAttribute('href', 'https://alpha.test');
  });
});

describe('ExportPdfDialog', () => {
  const baseProps = {
    open: true,
    onOpenChange: () => {},
    onScopeChange: () => {},
    onSelectedMessageChange: () => {},
    onExport: () => {},
    selectedMessageId: null,
    error: null,
  } as const;

  it('shows the empty state and disables export when there are no messages', () => {
    render(<ExportPdfDialog {...baseProps} messages={[]} scope="conversation" status="idle" />);

    expect(screen.getByText('This conversation has no messages to export.')).toBeInTheDocument();
    expect(screen.getByTestId('export-pdf-run')).toBeDisabled();
  });

  it('offers whole-conversation and single-message scopes with a picker', () => {
    render(
      <ExportPdfDialog
        {...baseProps}
        messages={[makeMessage({ messageId: 'a' })]}
        scope="message"
        status="idle"
      />,
    );

    expect(screen.getByText('Entire conversation')).toBeInTheDocument();
    expect(screen.getByText('Single message')).toBeInTheDocument();
    expect(screen.getByTestId('export-pdf-message-select')).toBeInTheDocument();
    expect(screen.getByTestId('export-pdf-run')).toBeDisabled();
  });

  it('surfaces a failure with a retry affordance', () => {
    render(
      <ExportPdfDialog
        {...baseProps}
        messages={[makeMessage()]}
        scope="conversation"
        status="error"
        error="Could not prepare the PDF. Please try again."
      />,
    );

    expect(screen.getByTestId('export-pdf-status')).toHaveTextContent(
      'Could not prepare the PDF. Please try again.',
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('disables the export control while a print run is in flight', () => {
    render(
      <ExportPdfDialog
        {...baseProps}
        messages={[makeMessage()]}
        scope="conversation"
        status="printing"
      />,
    );

    expect(screen.getByTestId('export-pdf-run')).toBeDisabled();
    expect(screen.getByTestId('export-pdf-status')).toBeInTheDocument();
  });
});
