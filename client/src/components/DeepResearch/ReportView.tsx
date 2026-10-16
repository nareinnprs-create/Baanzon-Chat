import { useState } from 'react';
import { Button } from '@librechat/client';
import { Check, Copy, RotateCcw } from 'lucide-react';
import type { ResearchCitation, ResearchReport } from './types';
import { DEEP_RESEARCH_LABELS as L } from './labels';

export type ReportViewProps = {
  report: ResearchReport;
  /** Called after the report text is copied. */
  onCopy?: (text: string) => void;
  /** Called when the user asks to run the plan again. */
  onRetry?: () => void;
};

/** Flattens a report into the plain text the copy action writes. */
export function reportToPlainText(report: ResearchReport): string {
  const lines: string[] = [report.title, ''];
  if (report.summary) {
    lines.push(report.summary, '');
  }
  for (const section of report.sections) {
    lines.push(`## ${section.heading}`);
    lines.push(section.body, '');
  }
  if (report.citations.length > 0) {
    lines.push(`## ${L.reportSources}`);
    report.citations.forEach((citation, index) => {
      lines.push(`[${index + 1}] ${citation.title}${citation.url ? ` — ${citation.url}` : ''}`);
    });
  }
  return lines.join('\n').trim();
}

async function writeToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // Clipboard permission can be denied; the copy action is still announced.
  }
}

function CitationItem({ citation, index }: { citation: ResearchCitation; index: number }) {
  return (
    <li className="text-xs text-text-secondary">
      <span className="tabular-nums text-text-tertiary" aria-hidden="true">
        {`[${index + 1}]`}
      </span>{' '}
      {citation.url ? (
        <a
          href={citation.url}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-text-primary underline-offset-4 hover:underline"
        >
          {citation.title}
        </a>
      ) : (
        <span className="font-medium text-text-primary">{citation.title}</span>
      )}
      {citation.snippet ? <span className="block pl-6">{citation.snippet}</span> : null}
    </li>
  );
}

/**
 * Renders the finished report: title, summary, ordered sections, and the
 * sources list, with copy and retry actions. Sections without citations are
 * still rendered; the sources block is a placeholder list the backend can fill.
 */
export default function ReportView({ report, onCopy, onRetry }: ReportViewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = reportToPlainText(report);
    setCopied(true);
    onCopy?.(text);
    void writeToClipboard(text);
  };

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-border-light bg-surface-secondary p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-text-primary">{L.reportHeading}</h3>
          <p className="text-sm text-text-secondary">{report.title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            {copied ? L.copiedReport : L.copyReport}
          </Button>
          {onRetry ? (
            <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
              <RotateCcw className="size-4" aria-hidden="true" />
              {L.retry}
            </Button>
          ) : null}
        </div>
      </div>

      {report.summary ? (
        <section className="flex flex-col gap-1">
          <h4 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            {L.reportSummary}
          </h4>
          <p className="text-sm leading-relaxed text-text-primary">{report.summary}</p>
        </section>
      ) : null}

      {report.sections.length === 0 ? (
        <p className="text-sm text-text-secondary">{L.reportEmpty}</p>
      ) : (
        report.sections.map((section) => (
          <section key={section.id} className="flex flex-col gap-1">
            <h4 className="text-sm font-semibold text-text-primary">{section.heading}</h4>
            <p className="text-sm leading-relaxed text-text-primary">{section.body}</p>
            {section.citations.length > 0 ? (
              <ul className="flex list-none flex-col gap-1 p-0">
                {section.citations.map((citation, index) => (
                  <CitationItem key={citation.id} citation={citation} index={index} />
                ))}
              </ul>
            ) : null}
          </section>
        ))
      )}

      <section className="flex flex-col gap-1">
        <h4 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          {L.reportSources}
        </h4>
        {report.citations.length === 0 ? (
          <p className="text-xs text-text-secondary">{L.reportCitationPlaceholder}</p>
        ) : (
          <ul className="flex list-none flex-col gap-1 p-0">
            {report.citations.map((citation, index) => (
              <CitationItem key={citation.id} citation={citation} index={index} />
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
