import { useState } from 'react';
import { Check, MessageSquare, RotateCcw, Trash2 } from 'lucide-react';
import { Button, EmptyState, Label, Textarea } from '@librechat/client';
import type { CanvasComment, CanvasSelection } from './types';
import { CANVAS_LABELS as L, formatCanvasLabel } from './labels';
import { countUnresolvedComments } from './state';
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

function anchorLabel(comment: CanvasComment): string {
  if (comment.anchor && comment.anchor.text.length > 0) {
    return formatCanvasLabel('commentAnchored', { quote: comment.anchor.text });
  }
  return L.commentNoAnchor;
}

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

  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-4 overflow-auto p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">{L.commentsHeading}</h3>
        <p aria-live="polite" className="text-xs text-text-secondary">
          {formatCanvasLabel('commentsUnresolvedCount', { count: unresolved })}
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-border-light bg-surface-secondary p-3">
        <Label htmlFor={composerId}>{L.commentComposerLabel}</Label>
        <p className="text-xs text-text-secondary">
          {selection && selection.text.length > 0
            ? formatCanvasLabel('commentAnchored', { quote: selection.text })
            : L.commentNoAnchor}
        </p>
        <Textarea
          id={composerId}
          value={body}
          rows={2}
          placeholder={L.commentComposerPlaceholder}
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
            {L.addComment}
          </Button>
        </div>
      </div>

      {comments.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title={L.commentsEmptyTitle}
          description={L.commentsEmptyDescription}
        />
      ) : (
        <ul aria-label={L.commentsHeading} className="flex list-none flex-col gap-2 p-0">
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
                    {L.commentResolved}
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
                    aria-label={L.reopenComment}
                    onClick={() => onReopen(comment.id)}
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                    {L.reopenComment}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={L.resolveComment}
                    onClick={() => onResolve(comment.id)}
                  >
                    <Check className="size-4" aria-hidden="true" />
                    {L.resolveComment}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={L.deleteComment}
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
