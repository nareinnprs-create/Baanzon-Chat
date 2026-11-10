import { useMemo } from 'react';
import { collapseDiff, diffLines } from '~/utils/diff';
import { useLocalize } from '~/hooks';

interface ArtifactDiffProps {
  previousContent?: string;
  currentContent?: string;
}

/**
 * X9: line-level diff between the previous artifact version and the one on
 * screen. Read-only, code-sized inputs, collapsed unchanged runs.
 */
export default function ArtifactDiff({ previousContent, currentContent }: ArtifactDiffProps) {
  const localize = useLocalize();
  const rows = useMemo(
    () => collapseDiff(diffLines(previousContent, currentContent)),
    [previousContent, currentContent],
  );

  const addCount = rows.filter((row) => row.type === 'add').length;
  const removeCount = rows.filter((row) => row.type === 'remove').length;

  const rowAriaLabel = (row: (typeof rows)[number]) => {
    if (row.type === 'add') return localize('com_ui_diff_added');
    if (row.type === 'remove') return localize('com_ui_diff_removed');
    return undefined;
  };

  const rowClassName = (row: (typeof rows)[number]) => {
    if (row.type === 'add') return 'bg-status-success/10 px-2 text-status-success';
    if (row.type === 'remove') return 'bg-status-destructive/10 text-status-destructive px-2';
    return 'px-2 text-text-secondary';
  };

  const rowSign = (row: (typeof rows)[number]) => {
    if (row.type === 'add') return '+';
    if (row.type === 'remove') return '−';
    return ' ';
  };

  return (
    <div
      className="h-full w-full overflow-auto bg-surface-primary p-3 font-mono text-xs"
      role="table"
      aria-label={localize('com_ui_artifact_diff')}
    >
      <div className="mb-2 flex gap-3 text-text-secondary" aria-hidden="true">
        <span className="text-status-success">+{addCount}</span>
        <span className="text-status-destructive">−{removeCount}</span>
      </div>
      {rows.map((row, index) =>
        row.collapsedGap != null ? (
          <div
            key={`gap-${index}`}
            className="my-1 border-y border-border-light py-0.5 text-center text-text-secondary"
            role="row"
          >
            {'⋯ '}
            {localize('com_ui_diff_gap', { 0: String(row.collapsedGap) })}
          </div>
        ) : (
          <div
            key={`row-${index}`}
            role="row"
            aria-label={rowAriaLabel(row)}
            className={rowClassName(row)}
          >
            <span aria-hidden="true" className="mr-2 inline-block w-3 select-none">
              {rowSign(row)}
            </span>
            <span className="whitespace-pre-wrap break-all">{row.text || ' '}</span>
          </div>
        ),
      )}
    </div>
  );
}
