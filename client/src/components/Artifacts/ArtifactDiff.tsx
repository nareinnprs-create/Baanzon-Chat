import { useMemo } from 'react';
import { useLocalize } from '~/hooks';
import { collapseDiff, diffLines } from '~/utils/diff';

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

  return (
    <div className="h-full w-full overflow-auto bg-surface-primary p-3 font-mono text-xs" role="table" aria-label={localize('com_ui_artifact_diff')}>
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
            ⋯ {localize('com_ui_diff_gap', { 0: String(row.collapsedGap) })}
          </div>
        ) : (
          <div
            key={`row-${index}`}
            role="row"
            aria-label={row.type === 'add' ? localize('com_ui_diff_added') : row.type === 'remove' ? localize('com_ui_diff_removed') : undefined}
            className={
              row.type === 'add'
                ? 'bg-status-success/10 px-2 text-status-success'
                : row.type === 'remove'
                  ? 'bg-status-destructive/10 px-2 text-status-destructive'
                  : 'px-2 text-text-secondary'
            }
          >
            <span aria-hidden="true" className="mr-2 inline-block w-3 select-none">
              {row.type === 'add' ? '+' : row.type === 'remove' ? '−' : ' '}
            </span>
            <span className="whitespace-pre-wrap break-all">{row.text || ' '}</span>
          </div>
        ),
      )}
    </div>
  );
}
