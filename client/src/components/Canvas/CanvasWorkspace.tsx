import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Button, EmptyState, Spinner } from '@librechat/client';
import { Layers, Plus, Redo2, TriangleAlert, Undo2 } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type {
  CanvasComment,
  CanvasDocument,
  CanvasEditOperation,
  CanvasSelection,
  CanvasVersion,
} from './types';
import type { MoveBlockDirection } from './state';
import type { CanvasLabelKey } from './labels';
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
import { saveCanvasSnapshot } from './storage';
import VersionHistory from './VersionHistory';
import { CANVAS_LABELS as L } from './labels';
import CommentsPanel from './CommentsPanel';
import CanvasEditor from './CanvasEditor';
import { toErrorMessage } from './utils';
import { useLocalize } from '~/hooks';
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
  /**
   * When set, the document, comments and versions are written to
   * `localStorage` under this key (debounced), so a reload or PWA restart does
   * not throw the work away. Load the same key into the initial props.
   */
  persistKey?: string;
};

const RIGHT_TABS: ReadonlyArray<{ id: RightTab; labelKey: CanvasLabelKey }> = [
  { id: 'preview', labelKey: L.previewTab },
  { id: 'comments', labelKey: L.commentsTab },
  { id: 'versions', labelKey: L.versionsTab },
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
  persistKey,
}: CanvasWorkspaceProps) {
  const localize = useLocalize();
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /**
   * Roving-tabindex tablist: inactive tabs are `tabIndex={-1}`, so without
   * arrow-key handling a keyboard user could never reach Comments or Versions.
   */
  const handleTabKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % RIGHT_TABS.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + RIGHT_TABS.length) % RIGHT_TABS.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = RIGHT_TABS.length - 1;
    }
    if (nextIndex == null) {
      return;
    }
    event.preventDefault();
    setTab(RIGHT_TABS[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }, []);

  const loadRef = useRef(loadDocument);
  useEffect(() => {
    loadRef.current = loadDocument;
  }, [loadDocument]);
  const localizeRef = useRef(localize);
  useEffect(() => {
    localizeRef.current = localize;
  }, [localize]);
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
        dispatch({
          type: 'load_failure',
          error: toErrorMessage(caught, localizeRef.current(L.failureDescription)),
        });
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
        author: localize(L.commentAuthorYou),
        at: new Date().toISOString(),
      });
      setAnnouncement(localize(L.commentAdded));
    },
    [dispatch, localize, state.document],
  );

  const handleCreateVersion = useCallback(() => {
    dispatch({
      type: 'create_version',
      // Numbered so snapshots are distinguishable at a glance; every version
      // used to be labelled "Save version".
      label: localize(L.versionLabel, { number: versions.length + 1 }),
      at: new Date().toISOString(),
    });
    setAnnouncement(localize(L.versionCreated));
  }, [dispatch, localize, versions.length]);

  const handleRestoreVersion = useCallback(
    (versionId: string) => {
      dispatch({ type: 'restore_version', versionId });
      setAnnouncement(localize(L.versionRestored));
    },
    [dispatch, localize],
  );

  const handleMoveBlock = useCallback(
    (blockId: string, direction: MoveBlockDirection) =>
      dispatch({ type: 'move_block', blockId, direction }),
    [dispatch],
  );

  useEffect(() => {
    if (!persistKey || !document) {
      return undefined;
    }
    // Debounced: a keystroke in a block should not serialize the whole
    // document on every character.
    const timer = window.setTimeout(() => {
      saveCanvasSnapshot(persistKey, { document, comments, versions });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [persistKey, document, comments, versions]);

  const handleRemoveBlock = useCallback(
    (blockId: string) => {
      dispatch({ type: 'remove_block', blockId });
      setAnnouncement(localize(L.blockRemoved));
    },
    [dispatch, localize],
  );

  let body;
  if (status === 'loading') {
    body = (
      <p role="status" className="flex items-center gap-2 p-6 text-sm text-text-secondary">
        <Spinner className="size-4" aria-hidden="true" />
        {localize(L.loading)}
      </p>
    );
  } else if (status === 'error') {
    body = (
      <div role="alert" className="p-4">
        <EmptyState
          icon={TriangleAlert}
          title={localize(L.failureTitle)}
          description={error ?? localize(L.failureDescription)}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              {localize(L.retry)}
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
          title={localize(L.emptyTitle)}
          description={localize(L.emptyDescription)}
          action={
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => dispatch({ type: 'insert_block' })}
            >
              <Plus className="size-4" aria-hidden="true" />
              {localize(L.addFirstBlock)}
            </Button>
          }
        />
      </div>
    );
  } else {
    body = (
      <SplitView
        leftLabel={localize(L.leftPane)}
        rightLabel={localize(L.rightPane)}
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
              aria-label={localize(L.sidePanelLabel)}
              className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border-light p-2"
            >
              {RIGHT_TABS.map((entry, index) => (
                <Button
                  key={entry.id}
                  id={`${baseId}-tab-${entry.id}`}
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  role="tab"
                  aria-selected={tab === entry.id}
                  aria-controls={`${baseId}-panel-${entry.id}`}
                  tabIndex={tab === entry.id ? 0 : -1}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'shrink-0 max-md:min-h-11',
                    tab === entry.id && 'bg-surface-active-alt',
                  )}
                  onClick={() => setTab(entry.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  {localize(entry.labelKey)}
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
                  <h3 className="text-sm font-semibold text-text-primary">
                    {localize(L.previewHeading)}
                  </h3>
                  {document.blocks.length === 0 ? (
                    <p className="text-sm text-text-secondary">{localize(L.previewEmpty)}</p>
                  ) : (
                    document.blocks.map((block) => (
                      <p
                        key={block.id}
                        className={cn(
                          'text-text-primary',
                          block.kind !== 'code' && 'whitespace-pre-wrap break-words',
                          block.kind === 'heading' && 'text-base font-semibold',
                          block.kind === 'paragraph' && 'text-sm',
                          block.kind === 'quote' &&
                            'border-l-2 border-border-medium pl-3 text-sm italic',
                          // Code must scroll, not wrap: wrapping mangles the
                          // indentation on a narrow screen.
                          block.kind === 'code' &&
                            'overflow-x-auto whitespace-pre rounded-lg bg-surface-secondary p-2 font-mono text-xs',
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
      aria-label={title ?? localize(L.featureTitle)}
      className={cn('flex h-full min-h-0 flex-col gap-4 p-4', className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
            <Layers className="size-4 text-text-secondary" aria-hidden="true" />
            {title ?? localize(L.featureTitle)}
          </h2>
          <p className="text-sm text-text-secondary">{localize(L.featureDescription)}</p>
        </div>

        {document ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="max-md:min-h-11 max-md:min-w-11"
              aria-label={localize(L.undo)}
              disabled={!canUndo}
              onClick={() => dispatch({ type: 'undo' })}
            >
              <Undo2 className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="max-md:min-h-11 max-md:min-w-11"
              aria-label={localize(L.redo)}
              disabled={!canRedo}
              onClick={() => dispatch({ type: 'redo' })}
            >
              <Redo2 className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="max-md:min-h-11"
              onClick={() => dispatch({ type: 'insert_block' })}
            >
              <Plus className="size-4" aria-hidden="true" />
              {localize(L.addBlock)}
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              className="max-md:min-h-11"
              onClick={handleCreateVersion}
            >
              {localize(L.createVersion)}
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
