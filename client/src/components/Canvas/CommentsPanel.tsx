import { useState } from 'react';
import { Check, MessageSquare, RotateCcw, Trash2 } from 'lucide-react';
import { Button, EmptyState, Label, Textarea } from '@librechat/client';
import type { CanvasComment, CanvasSelection } from './types';
import { CANVAS_LABELS as L } from './labels';
import { countUnresolvedComments } from './state';
import { useLocalize } from '~/hooks';
import { formatTimestamp } from '~/utils/canvas';
import { cn } from '~/utils';

export type CommentsPanelProps = {
  comments: CanvasComment[];
  /** The live selection, shown so a new comment can be anchored to it. */
  selection: CanvasSelection | null;
  className?: string;
  onAdd: (body: string, selection: CanvasSelection | null) => void;
  onResolve: (commentId: string) => void;
  onReopen: (commentId: string) => void;
  onDelete: (commentId: string) => void;
};

/**
 * Anchored review comments: an accessible list with add, resolve/reopen and
 * delete, plus a composer that targets the current editor selection. Purely
 * presentational — the comment collection and every mutation are supplied by
 * the workspace, which owns the reducer.
 */
export default function CommentsPanel({
  comments,
  selection,
  className,
  onAdd,
  onResolve,
  onReopen,
  onDelete,
}: CommentsPanelProps) {
  const localize = useLocalize();
  const [body, setBody] = useState('');
  const composerId = 'canvas-comment-composer';
  const trimmed = body.trim();

  const handleAdd = () => {
    if (trimmed.length === 0) {
      return;
    }
    onAdd(trimmed, selection);
    setBody('');
  };

  const unresolved = countUnresolvedComments(comments);

  const anchorLabel = (comment: CanvasComment) =>
    comment.anchor && comment.anchor.text.length > 0
      ? localize(L.commentAnchored, { quote: comment.anchor.text })
      : localize(L.commentNoAnchor);

  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-4 overflow-auto p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">{localize(L.commentsHeading)}</h3>
        <p aria-live="polite" className="text-xs text-text-secondary">
          {localize(L.commentsUnresolvedCount, { count: unresolved })}
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-border-light bg-surface-secondary p-3">
        <Label htmlFor={composerId}>{localize(L.commentComposerLabel)}</Label>
        <p className="text-xs text-text-secondary">
          {selection && selection.text.length > 0
            ? localize(L.commentAnchored, { quote: selection.text })
            : localize(L.commentNoAnchor)}
        </p>
        <Textarea
          id={composerId}
          value={body}
          rows={2}
          placeholder={localize(L.commentComposerPlaceholder)}
          onChange={(event) => setBody(event.target.value)}
        />
        <div>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={trimmed.length === 0}
            onClick={handleAdd}
          >
            {localize(L.addComment)}
          </Button>
        </div>
      </div>

      {comments.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title={localize(L.commentsEmptyTitle)}
          description={localize(L.commentsEmptyDescription)}
        />
      ) : (
        <ul aria-label={localize(L.commentsHeading)} className="flex list-none flex-col gap-2 p-0">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className={cn(
                'flex flex-col gap-2 rounded-xl border border-border-light p-3',
                comment.resolved ? 'bg-surface-secondary' : 'bg-surface-primary',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p
                  className={cn(
                    'min-w-0 flex-1 break-words text-sm',
                    comment.resolved ? 'text-text-secondary' : 'text-text-primary',
                  )}
                >
                  {comment.body}
                </p>
                {comment.resolved ? (
                  <span className="shrink-0 rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary">
                    {localize(L.commentResolved)}
                  </span>
                ) : null}
              </div>
              <p className="break-words text-xs italic text-text-secondary">
                {anchorLabel(comment)}
              </p>
              <p className="text-xs text-text-secondary">
                {`${comment.author} · ${formatTimestamp(comment.createdAt)}`}
              </p>
              <div className="flex flex-wrap items-center gap-1">
                {comment.resolved ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={localize(L.reopenComment)}
                    onClick={() => onReopen(comment.id)}
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                    {localize(L.reopenComment)}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={localize(L.resolveComment)}
                    onClick={() => onResolve(comment.id)}
                  >
                    <Check className="size-4" aria-hidden="true" />
                    {localize(L.resolveComment)}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={localize(L.deleteComment)}
                  onClick={() => onDelete(comment.id)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}