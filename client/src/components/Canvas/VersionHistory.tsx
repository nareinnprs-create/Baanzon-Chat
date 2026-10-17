import { Button, EmptyState } from '@librechat/client';
import { History, RotateCcw, Save, Trash2 } from 'lucide-react';
import type { CanvasDocument, CanvasVersion } from './types';
import { CANVAS_LABELS as L, formatCanvasLabel } from './labels';
import { formatTimestamp } from '~/utils/canvas';
import { describeVersionDiff } from './state';
import { cn } from '~/utils';

export type VersionHistoryProps = {
  versions: CanvasVersion[];
  /** The document versions are compared against for the diff summary. */
  currentDocument: CanvasDocument | null;
  className?: string;
  /** Snapshot the current document; omitted when saving is not offered. */
  onCreate?: () => void;
  onRestore: (versionId: string) => void;
  onDelete?: (versionId: string) => void;
};

/**
 * The version list: each snapshot shows its label, when it was saved, and a
 * block-level diff against the current document, with a restore action and an
 * optional delete. Purely presentational; the workspace owns the collection.
 */
export default function VersionHistory({
  versions,
  currentDocument,
  className,
  onCreate,
  onRestore,
  onDelete,
}: VersionHistoryProps) {
  const ordered = [...versions].reverse();

  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-4 overflow-auto p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">{L.versionsHeading}</h3>
        {onCreate ? (
          <Button type="button" variant="outline" size="sm" onClick={onCreate}>
            <Save className="size-4" aria-hidden="true" />
            {L.createVersion}
          </Button>
        ) : null}
      </div>

      {versions.length === 0 ? (
        <EmptyState
          icon={History}
          title={L.versionsEmptyTitle}
          description={L.versionsEmptyDescription}
        />
      ) : (
        <ul aria-label={L.versionsHeading} className="flex list-none flex-col gap-2 p-0">
          {ordered.map((version) => {
            const diff = describeVersionDiff(version.document, currentDocument);
            const changed = diff.added + diff.removed + diff.changed > 0;
            const isCurrent = !changed && version.document.title === currentDocument?.title;
            return (
              <li
                key={version.id}
                className="flex flex-col gap-1.5 rounded-xl border border-border-light bg-surface-primary p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 break-words text-sm font-medium text-text-primary">
                    {version.label}
                  </span>
                  {isCurrent ? (
                    <span className="shrink-0 rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary">
                      {L.versionCurrent}
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-text-secondary">
                  {formatCanvasLabel('versionCreatedAt', {
                    at: formatTimestamp(version.createdAt),
                  })}
                </p>
                <p className="text-xs text-text-secondary" data-testid="canvas-version-diff">
                  {changed
                    ? formatCanvasLabel('versionDiffSummary', {
                        added: diff.added,
                        removed: diff.removed,
                        changed: diff.changed,
                      })
                    : L.versionDiffUnchanged}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isCurrent}
                    onClick={() => onRestore(version.id)}
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                    {L.restoreVersion}
                  </Button>
                  {onDelete ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={L.deleteVersion}
                      onClick={() => onDelete(version.id)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
