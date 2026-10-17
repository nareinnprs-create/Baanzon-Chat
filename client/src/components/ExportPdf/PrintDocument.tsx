import { createPortal } from 'react-dom';
import type { ExportDocument } from './types';
import { useLocalize } from '~/hooks';

/**
 * Print-only rendering of the export document, portaled to `<body>` so it sits
 * as a direct child the print stylesheet can reveal while hiding the app shell
 * (`html.librechat-exporting body > *:not(.librechat-export-print)`).
 *
 * The style block is inlined and uses fixed black-on-white on purpose: paper is
 * a fixed light medium, and the semantic theme tokens (which follow the app's
 * light/dark surface) would print a dark surface or inverted text illegibly.
 * This is the documented exception to the semantic-token rule — it is a print
 * surface, not an app surface.
 */
const PRINT_STYLES = `
@media screen {
  .librechat-export-print { display: none !important; }
}
@media print {
  html.librechat-exporting body > *:not(.librechat-export-print) { display: none !important; }
  html.librechat-exporting body > .librechat-export-print {
    position: static !important;
    display: block !important;
    width: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    color: #000 !important;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 11pt;
    line-height: 1.45;
  }
  .librechat-export-print .librechat-export-title { font-size: 18pt; margin: 0 0 2pt; }
  .librechat-export-print .librechat-export-meta { font-size: 9pt; color: #444; margin: 0 0 12pt; }
  .librechat-export-print .librechat-export-message { margin: 0 0 14pt; break-inside: avoid; }
  .librechat-export-print .librechat-export-message-header { font-weight: 700; margin: 0 0 2pt; }
  .librechat-export-print .librechat-export-timestamp {
    font-weight: 400;
    font-size: 9pt;
    color: #555;
    margin-left: 6pt;
  }
  .librechat-export-print .librechat-export-body { white-space: pre-wrap; overflow-wrap: anywhere; }
  .librechat-export-print .librechat-export-note {
    font-size: 9pt;
    font-style: italic;
    color: #555;
    margin: 2pt 0 0;
  }
  .librechat-export-print .librechat-export-sources {
    margin-top: 6pt;
    padding-top: 4pt;
    border-top: 0.5pt solid #999;
    font-size: 9pt;
  }
  .librechat-export-print .librechat-export-sources-title { font-size: 10pt; margin: 0 0 2pt; }
  .librechat-export-print .librechat-export-sources-list { margin: 0; padding-left: 16pt; }
  .librechat-export-print .librechat-export-sources-list li { margin: 0 0 2pt; }
  .librechat-export-print a { color: #000; text-decoration: underline; overflow-wrap: anywhere; }
  .librechat-export-print .librechat-export-snippet { color: #444; }
  @page { margin: 16mm; }
}
`;

export default function PrintDocument({ document }: { document: ExportDocument }) {
  const localize = useLocalize();

  if (typeof window === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="librechat-export-print" data-testid="export-print-document">
      <style>{PRINT_STYLES}</style>
      <h1 className="librechat-export-title">{document.title}</h1>
      <p className="librechat-export-meta">
        {localize('com_ui_export_pdf_exported_at', { date: document.exportedAt })}
      </p>
      {document.messages.map((message, index) => (
        <article
          key={message.id || `message-${index}`}
          className="librechat-export-message"
          data-testid="export-print-message"
        >
          <div className="librechat-export-message-header">
            <span className="librechat-export-sender">{message.sender}</span>
            {message.createdAt && (
              <span className="librechat-export-timestamp">{message.createdAt}</span>
            )}
          </div>
          <div className="librechat-export-body">{message.text}</div>
          {message.error && (
            <p className="librechat-export-note">{localize('com_ui_export_pdf_error_message')}</p>
          )}
          {message.citations.length > 0 && (
            <section
              className="librechat-export-sources"
              aria-label={localize('com_ui_export_pdf_sources')}
            >
              <h2 className="librechat-export-sources-title">
                {localize('com_ui_export_pdf_sources')}
              </h2>
              <ol className="librechat-export-sources-list" data-testid="export-print-sources">
                {message.citations.map((citation) => (
                  <li key={citation.index} value={citation.index}>
                    {citation.link ? (
                      <a href={citation.link} rel="noreferrer" target="_blank">
                        {citation.title || citation.link}
                      </a>
                    ) : (
                      <span>{citation.title || citation.attribution}</span>
                    )}
                    {citation.snippet && (
                      <span className="librechat-export-snippet"> — {citation.snippet}</span>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </article>
      ))}
    </div>,
    window.document.body,
  );
}
