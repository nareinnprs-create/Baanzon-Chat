import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Button, EmptyState, Spinner } from '@librechat/client';
import { Layers, Plus, Redo2, TriangleAlert, Undo2 } from 'lucide-react';
import type {
  CanvasComment,
  CanvasDocument,
  CanvasEditOperation,
  CanvasSelection,
  CanvasVersion,
} from './types';
import type { MoveBlockDirection } from './state';
import type { EditSelectionFn } from './api';
import {
  canvasCanRedoAtom,
  canvasCanUndoAtom,
  canvasCommentsAtom,
  canvasDocumentAtom,
  canvasErrorAtom,
  canvasSelectionAtom,
  canvasStateAtom,
  canvasStatusAtom,
  canvasVersionsAtom,
  dispatchCanvasAtom,
} from './atoms';
import VersionHistory from './VersionHistory';
import { CANVAS_LABELS as L } from './labels';
import CommentsPanel from './CommentsPanel';
import CanvasEditor from './CanvasEditor';
import SplitView from './SplitView';
import { cn } from '~/utils';

type RightTab = 'preview' | 'comments' | 'versions';

export type CanvasWorkspaceProps = {
  /** A document supplied directly by the host; skips loading entirely. */
  document?: CanvasDocument | null;
  /** Injected loader used when `document` is not supplied. Must be stable. */
  loadDocument?: () => Promise<CanvasDocument>;
  /**
   * The injected AI edit backend, forwarded to the editor. The workspace never
   * imports a transport, so a real adapter and an in-memory reference are
   * interchangeable.
   */
  editSelection: EditSelectionFn;
  initialVersions?: CanvasVersion[];
  initialComments?: CanvasComment[];
  title?: string;
  className?: string;
};

function toErrorMessage(caught: unknown): string {
  if (caught instanceof Error && caught.message) {
    return caught.message;
  }
  if (typeof caught === 'string' && caught) {
    return caught;
  }
  return L.failureDescription;
}

const RIGHT_TABS: ReadonlyArray<{ id: RightTab; label: string }> = [
  { id: 'preview', label: L.previewTab },
  { id: 'comments', label: L.commentsTab },
  { id: 'versions', label: L.versionsTab },
];

/**
 * The Canvas workspace: a resizable split view pairing the editable document
 * with a side panel (preview, comments, versions), across explicit loading,
 * empty, success and failure states with retry. All state lives in the
 * feature's Jotai atoms; the only seams to a backend are the injected
 * `loadDocument` and `editSelection` functions.
 */
export default function CanvasWorkspace({
  document: documentProp = null,
  loadDocument,
  editSelection,
  initialVersions,
  initialComments,
  title,
  className,
}: CanvasWorkspaceProps) {
  const state = useAtomValue(canvasStateAtom);
  const document = useAtomValue(canvasDocumentAtom);
  const selection = useAtomValue(canvasSelectionAtom);
  const versions = useAtomValue(canvasVersionsAtom);
  const comments = useAtomValue(canvasCommentsAtom);
  const status = useAtomValue(canvasStatusAtom);
  const error = useAtomValue(canvasErrorAtom);
  const canUndo = useAtomValue(canvasCanUndoAtom);
  const canRedo = useAtomValue(canvasCanRedoAtom);
  const dispatch = useSetAtom(dispatchCanvasAtom);

  const baseId = useId();
  const [tab, setTab] = useState<RightTab>('preview');
  const [reloadKey, setReloadKey] = useState(0);
  const [announcement, setAnnouncement] = useState('');

  const loadRef = useRef(loadDocument);
  useEffect(() => {
    loadRef.current = loadDocument;
  }, [loadDocument]);
  const initialVersionsRef = useRef(initialVersions);
  const initialCommentsRef = useRef(initialComments);

  useEffect(() => {
    if (documentProp != null) {
      dispatch({
        type: 'load_success',
        document: documentProp,
        versions: initialVersionsRef.current,
        comments: initialCommentsRef.current,
      });
      return undefined;
    }
    const loader = loadRef.current;
    if (!loader) {
      return undefined;
    }
    const controller = new AbortController();
    dispatch({ type: 'load_start' });
    loader()
      .then((loaded) => {
        if (controller.signal.aborted) {
          return;
        }
        dispatch({
          type: 'load_success',
          document: loaded,
          versions: initialVersionsRef.current,
          comments: initialCommentsRef.current,
        });
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        dispatch({ type: 'load_failure', error: toErrorMessage(caught) });
      });
    return () => controller.abort();
  }, [dispatch, documentProp, reloadKey]);

  const handleSelectionChange = useCallback(
    (next: CanvasSelection | null) => dispatch({ type: 'set_selection', selection: next }),
    [dispatch],
  );

  const handleOperations = useCallback(
    (operations: CanvasEditOperation[]) => dispatch({ type: 'apply_operations', operations }),
    [dispatch],
  );

  const handleAddComment = useCallback(
    (body: string, anchor: CanvasSelection | null) => {
      const blockId = anchor?.blockId ?? state.document?.blocks[0]?.id;
      if (!blockId) {
        return;
      }
      dispatch({
        type: 'add_comment',
        blockId,
        anchor: anchor ? { start: anchor.start, end: anchor.end, text: anchor.text } : null,
        body,
        author: L.commentAuthorYou,
        at: new Date().toISOString(),
      });
      setAnnouncement(L.commentAdded);
    },
    [dispatch, state.document],
  );

  const handleCreateVersion = useCallback(() => {
    dispatch({ type: 'create_version', label: L.createVersion, at: new Date().toISOString() });
    setAnnouncement(L.versionCreated);
  }, [dispatch]);

  const handleRestoreVersion = useCallback(
    (versionId: string) => {
      dispatch({ type: 'restore_version', versionId });
      setAnnouncement(L.versionRestored);
    },
    [dispatch],
  );

  const handleMoveBlock = useCallback(
    (blockId: string, direction: MoveBlockDirection) =>
      dispatch({ type: 'move_block', blockId, direction }),
    [dispatch],
  );

  const handleRemoveBlock = useCallback(
    (blockId: string) => {
      dispatch({ type: 'remove_block', blockId });
      setAnnouncement(L.blockRemoved);
    },
    [dispatch],
  );

  let body;
  if (status === 'loading') {
    body = (
      <p role="status" className="flex items-center gap-2 p-6 text-sm text-text-secondary">
        <Spinner className="size-4" aria-hidden="true" />
        {L.loading}
      </p>
    );
  } else if (status === 'error') {
    body = (
      <div role="alert" className="p-4">
        <EmptyState
          icon={TriangleAlert}
          title={L.failureTitle}
          description={error ?? L.failureDescription}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              {L.retry}
            </Button>
          }
        />
      </div>
    );
  } else if (!document) {
    body = (
      <div className="p-4">
        <EmptyState
          icon={Layers}
          title={L.emptyTitle}
          description={L.emptyDescription}
          action={
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => dispatch({ type: 'insert_block' })}
            >
              <Plus className="size-4" aria-hidden="true" />
              {L.addFirstBlock}
            </Button>
          }
        />
      </div>
    );
  } else {
    body = (
      <SplitView
        leftLabel={L.leftPane}
        rightLabel={L.rightPane}
        left={
          <CanvasEditor
            document={document}
            selection={selection}
            editSelection={editSelection}
            onTitleChange={(next) => dispatch({ type: 'set_title', title: next })}
            onBlockTextChange={(blockId, text) =>
              dispatch({ type: 'set_block_text', blockId, text })
            }
            onSelectionChange={handleSelectionChange}
            onMoveBlock={handleMoveBlock}
            onRemoveBlock={handleRemoveBlock}
            onOperations={handleOperations}
          />
        }
        right={
          <div className="flex h-full min-h-0 flex-col">
            <div
              role="tablist"
              aria-label={L.sidePanelLabel}
              className="flex shrink-0 items-center gap-1 border-b border-border-light p-2"
            >
              {RIGHT_TABS.map((entry) => (
                <Button
                  key={entry.id}
                  id={`${baseId}-tab-${entry.id}`}
                  role="tab"
                  aria-selected={tab === entry.id}
                  aria-controls={`${baseId}-panel-${entry.id}`}
                  tabIndex={tab === entry.id ? 0 : -1}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(tab === entry.id && 'bg-surface-active-alt')}
                  onClick={() => setTab(entry.id)}
                >
                  {entry.label}
                </Button>
              ))}
            </div>
            <div
              role="tabpanel"
              id={`${baseId}-panel-${tab}`}
              aria-labelledby={`${baseId}-tab-${tab}`}
              className="min-h-0 flex-1 overflow-hidden"
            >
              {tab === 'preview' ? (
                <div className="flex h-full flex-col gap-3 overflow-auto p-4">
                  <h3 className="text-sm font-semibold text-text-primary">{L.previewHeading}</h3>
                  {document.blocks.length === 0 ? (
                    <p className="text-sm text-text-secondary">{L.previewEmpty}</p>
                  ) : (
                    document.blocks.map((block) => (
                      <p
                        key={block.id}
                        className={cn(
                          'whitespace-pre-wrap break-words text-text-primary',
                          block.kind === 'heading' && 'text-base font-semibold',
                          block.kind === 'paragraph' && 'text-sm',
                          block.kind === 'quote' &&
                            'border-l-2 border-border-medium pl-3 text-sm italic',
                          block.kind === 'code' &&
                            'rounded-lg bg-surface-secondary p-2 font-mono text-xs',
                        )}
                      >
                        {block.text}
                      </p>
                    ))
                  )}
                </div>
              ) : null}
              {tab === 'comments' ? (
                <CommentsPanel
                  comments={comments}
                  selection={selection}
                  onAdd={handleAddComment}
                  onResolve={(commentId) => dispatch({ type: 'resolve_comment', commentId })}
                  onReopen={(commentId) => dispatch({ type: 'reopen_comment', commentId })}
                  onDelete={(commentId) => dispatch({ type: 'delete_comment', commentId })}
                />
              ) : null}
              {tab === 'versions' ? (
                <VersionHistory
                  versions={versions}
                  currentDocument={document}
                  onCreate={handleCreateVersion}
                  onRestore={handleRestoreVersion}
                  onDelete={(versionId) => dispatch({ type: 'delete_version', versionId })}
                />
              ) : null}
            </div>
          </div>
        }
      />
    );
  }

  return (
    <section
      aria-label={title ?? L.featureTitle}
      className={cn('flex h-full min-h-0 flex-col gap-4 p-4', className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
            <Layers className="size-4 text-text-secondary" aria-hidden="true" />
            {title ?? L.featureTitle}
          </h2>
          <p className="text-sm text-text-secondary">{L.featureDescription}</p>
        </div>

        {document ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={L.undo}
              disabled={!canUndo}
              onClick={() => dispatch({ type: 'undo' })}
            >
              <Undo2 className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={L.redo}
              disabled={!canRedo}
              onClick={() => dispatch({ type: 'redo' })}
            >
              <Redo2 className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => dispatch({ type: 'insert_block' })}
            >
              <Plus className="size-4" aria-hidden="true" />
              {L.addBlock}
            </Button>
            <Button type="button" variant="default" size="sm" onClick={handleCreateVersion}>
              {L.createVersion}
            </Button>
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1">{body}</div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
