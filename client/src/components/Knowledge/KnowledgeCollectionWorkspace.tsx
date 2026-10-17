import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useAtom } from 'jotai';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  FilePlus2,
  FileText,
  Pencil,
  PowerOff,
  ScanSearch,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import {
  Button,
  Chip,
  EmptyState,
  Input,
  Label,
  Spinner,
  Textarea,
  TooltipAnchor,
  useMediaQuery,
  useToastContext,
} from '@librechat/client';
import type { LucideIcon } from 'lucide-react';
import {
  isKnowledgeDisabledError,
  useAddKnowledgeDocumentMutation,
  useDeleteKnowledgeDocumentMutation,
  useKnowledgeCollectionQuery,
  useKnowledgeCollectionsEnabledQuery,
  useRetrieveKnowledgeMutation,
  KNOWLEDGE_CONTENT_MAX_LENGTH,
  KNOWLEDGE_QUERY_MAX_LENGTH,
  KNOWLEDGE_QUERY_MAX_UNITS,
  isKnowledgeQueryTooLong,
} from '~/data-provider';
import {
  knowledgeDocumentDraftFamily,
  knowledgeIngestedDocumentsFamily,
  knowledgeRetrieveQueryFamily,
  knowledgeRetrieveResultsFamily,
  knowledgeSelectedCollectionIdAtom,
  canWriteKnowledgeCollection,
  type KnowledgeIngestedDocument,
} from './state';
import { getKnowledgeScopeLabel } from './KnowledgeCreateDialog';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import KnowledgeDeleteDialog from './KnowledgeDeleteDialog';
import KnowledgeEditDialog from './KnowledgeEditDialog';
import { useAuthContext, useLocalize } from '~/hooks';
import { getKnowledgeErrorMessage } from './errors';
import { isNotFoundError } from '~/utils/errors';
import { cn } from '~/utils';

function formatDate(value?: string): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const PREVIEW_LENGTH = 80;

/** One line of what was indexed, so a row pasted without a source still says
 *  something. Newlines collapse because the row is a single truncated line.
 *
 *  Sliced by code point rather than with `String#slice`, which counts UTF-16 code
 *  units: a cut between the halves of a surrogate pair leaves a lone surrogate
 *  that renders as the replacement glyph, so the preview showed a box exactly
 *  where the character was. */
function buildTextPreview(content: string): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  const points = [...collapsed];
  return points.length > PREVIEW_LENGTH
    ? `${points.slice(0, PREVIEW_LENGTH).join('')}…`
    : collapsed;
}

function CollectionStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5 text-xs text-text-secondary">
      <span>{label}</span>
      <span className="font-medium text-text-primary">{value}</span>
    </span>
  );
}

/**
 * A page-level state, announced rather than merely drawn.
 *
 * These three branches replace everything the page was showing, so a screen
 * reader that never hears about them is left with a `<main>` that went blank and
 * no reason why. `alert` for the failure and the kill switch (something the user
 * has to act on interrupts), `status` for the informational ones.
 */
function AnnouncedState({ assertive, children }: { assertive?: boolean; children: ReactNode }) {
  return <div role={assertive ? 'alert' : 'status'}>{children}</div>;
}

export default function KnowledgeCollectionWorkspace() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { collectionId = '' } = useParams();
  const formId = useId();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  /** The row whose delete is armed, and the header buttons the collection dialogs
   *  were opened from, so focus has somewhere to go back to. */
  const armedDocumentRef = useRef<string | null>(null);
  const deleteTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  /** The armed row's Cancel button, and `isArmed` is true for exactly one row at a
   *  time, so one ref is enough. */
  const cancelDeleteButtonRef = useRef<HTMLButtonElement | null>(null);
  const sessionHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null);
  /** `isLoading` only reaches the buttons on the next render, so a double click on
   *  either form put the same request through twice. These latches are synchronous. */
  const isIngesting = useRef(false);
  const isQuerying = useRef(false);

  const [, setSelectedCollectionId] = useAtom(knowledgeSelectedCollectionIdAtom);
  const [documentDraft, setDocumentDraft] = useAtom(knowledgeDocumentDraftFamily(collectionId));
  const [retrieveQuery, setRetrieveQuery] = useAtom(knowledgeRetrieveQueryFamily(collectionId));
  const [snippets, setSnippets] = useAtom(knowledgeRetrieveResultsFamily(collectionId));
  const [ingestedDocuments, setIngestedDocuments] = useAtom(
    knowledgeIngestedDocumentsFamily(collectionId),
  );

  const { data, isLoading, isError, error } = useKnowledgeCollectionQuery(collectionId);
  const collection = data?.collection;
  /**
   * How much room the deployment's vector index has left, from the one route that
   * reports it (`GET /knowledge`, whose `capacity` field a persistent store fills
   * in). The detail route does not carry it, and it is read here so a 409 is
   * something the form can *anticipate* rather than only explain afterwards:
   * capacity exhaustion is deployment-wide and permanent, so once it is gone
   * every later ingest fails identically, and pasting a 400 000-character
   * document to be refused is the whole cost.
   *
   * The probe is the same query the sidebar already mounts on every knowledge
   * route, under one key, so this is an observer joining an existing cache entry
   * rather than a new endpoint. `null` means the store does not report usage at
   * all — which is what `InMemoryVectorStore`, the store that raises the 409 in
   * the first place, answers — and then there is nothing to say and nothing is
   * drawn, exactly as `TKnowledgeCapacity` documents.
   */
  const { data: availability } = useKnowledgeCollectionsEnabledQuery();
  const remainingChunks = availability?.capacity?.remainingChunks ?? null;
  const addDocument = useAddKnowledgeDocumentMutation();
  const deleteDocument = useDeleteKnowledgeDocumentMutation();
  const retrieve = useRetrieveKnowledgeMutation();
  const { showToast } = useToastContext();
  /** The cap is on code points, which `maxLength` cannot express, so it is gated
   *  here — and on the button, not only in the submit handler. The attribute is
   *  twice the cap so it never refuses a question the server would take, and a
   *  question past the real cap has to look refused rather than accept a click
   *  that does nothing. */
  const isQueryTooLong = isKnowledgeQueryTooLong(retrieveQuery);

  useEffect(() => {
    if (collectionId) {
      setSelectedCollectionId(collectionId);
    }
  }, [collectionId, setSelectedCollectionId]);

  /**
   * Focus follows the row being deleted.
   *
   * Arming swaps the trash button — the thing the user had just focused — for a
   * Cancel/Delete pair, so the focused node is destroyed and focus lands on
   * `<body>`; from there the next Tab restarts at the top of the page. This
   * effect hands the pair focus on its way in: Cancel, so a stray Enter cannot
   * destroy anything (on the destructive button it would), and not the pair's
   * container, which is not focusable. The focus is moved by an effect rather
   * than `autoFocus` because `autoFocus` is unreliable on a node that is only
   * conditionally mounted — it is honoured on mount only when the element is
   * already in the document, which a just-rendered swap cannot promise.
   */
  useEffect(() => {
    if (pendingDeleteId == null) {
      return;
    }
    cancelDeleteButtonRef.current?.focus();
  }, [pendingDeleteId]);

  /**
   * …and un-arming hands it back: to the row's own delete button when the row is
   * still there, and to the section heading when it is not — which is the
   * successful case, since the row is deleted along with the document. The
   * ref map is never pruned on unmount because the button is re-created by the
   * very render this effect reacts to, and reading a stale node would be a
   * `isConnected` false every time.
   */
  useEffect(() => {
    if (pendingDeleteId != null) {
      return;
    }
    const documentId = armedDocumentRef.current;
    armedDocumentRef.current = null;
    if (documentId == null) {
      return;
    }
    const trigger = deleteTriggerRefs.current.get(documentId);
    if (trigger != null && trigger.isConnected) {
      trigger.focus();
      return;
    }
    sessionHeadingRef.current?.focus();
  }, [pendingDeleteId]);

  const armDelete = useCallback((documentId: string) => {
    armedDocumentRef.current = documentId;
    setPendingDeleteId(documentId);
  }, []);

  const registerDeleteTrigger = useCallback(
    (documentId: string) => (node: HTMLButtonElement | null) => {
      if (node != null) {
        deleteTriggerRefs.current.set(documentId, node);
      }
    },
    [],
  );

  const goBack = () => navigate('/knowledge');

  const handleAddDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = documentDraft.content.trim();
    if (!content || content.length > KNOWLEDGE_CONTENT_MAX_LENGTH || isIngesting.current) {
      return;
    }

    isIngesting.current = true;
    const source = documentDraft.source.trim();
    try {
      const result = await addDocument.mutateAsync({
        collectionId,
        content,
        ...(source ? { source } : {}),
      });
      /** The counters belong to the server, so the form clears and the invalidated
       *  detail query is what repaints them. */
      setDocumentDraft({ content: '', source: '' });
      setSnippets(null);
      /** The response is the only place a `documentId` ever appears, so it is
       *  recorded here — that id is the sole way back to the delete endpoint. */
      setIngestedDocuments((current) => [
        {
          documentId: result.documentId,
          chunkCount: result.chunkCount,
          source,
          textPreview: buildTextPreview(content),
          addedAt: Date.now(),
        },
        ...current,
      ]);
      showToast({
        message: localize('com_ui_knowledge_document_added', { count: result.chunkCount }),
        status: 'success',
      });
    } catch (ingestError) {
      /** The draft is left alone on purpose: the same text can be resubmitted
       *  without retyping it, and the button is live again the moment this settles. */
      showToast({
        message: getKnowledgeErrorMessage(ingestError, localize),
        status: 'error',
      });
    } finally {
      isIngesting.current = false;
    }
  };

  const handleDeleteDocument = (entry: KnowledgeIngestedDocument) => {
    deleteDocument.mutate(
      { collectionId, documentId: entry.documentId },
      {
        onSuccess: () => {
          setIngestedDocuments((current) =>
            current.filter((document) => document.documentId !== entry.documentId),
          );
          /** The row is going with the document, so the focus fallback has to be the
           *  section heading rather than a button that will not be there. */
          deleteTriggerRefs.current.delete(entry.documentId);
          setPendingDeleteId(null);
          showToast({
            message: localize('com_ui_knowledge_document_deleted'),
            status: 'success',
          });
        },
        onError: (deleteError) => {
          /** The row stays and stays armed: the document is still indexed, so the
           *  same confirm button can simply be pressed again. */
          showToast({
            message: getKnowledgeErrorMessage(deleteError, localize),
            status: 'error',
          });
        },
      },
    );
  };

  const handleRunQuery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = retrieveQuery.trim();
    /** `content` is the one cap the server measures in code units, so `.length`
     *  is its exact match; `query` is counted in code points there. */
    if (!query || isQueryTooLong || isQuerying.current) {
      return;
    }

    isQuerying.current = true;
    try {
      const result = await retrieve.mutateAsync({ collectionId, query });
      setSnippets(result.snippets);
    } catch (retrieveError) {
      setSnippets(null);
      showToast({
        message: getKnowledgeErrorMessage(retrieveError, localize),
        status: 'error',
      });
    } finally {
      isQuerying.current = false;
    }
  };

  const renderState = (icon: LucideIcon, message: string, assertive = true) => (
    <main className="flex h-full flex-col items-center justify-center gap-3 bg-presentation px-6 text-center">
      <AnnouncedState assertive={assertive}>
        <EmptyState icon={icon} description={message} className="w-full max-w-md" />
      </AnnouncedState>
      <Button type="button" variant="outline" size="sm" onClick={goBack}>
        {localize('com_ui_knowledge_back')}
      </Button>
    </main>
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-presentation">
        <Spinner className="text-text-primary" />
      </div>
    );
  }

  /** 503 comes from the `rag.disabled` switch and is answered on every route, so it
   *  is read off the status rather than a message. */
  if (isError && isKnowledgeDisabledError(error)) {
    return renderState(PowerOff, localize('com_ui_knowledge_error_disabled'));
  }

  /** A collection deleted in another tab, or by an administrator, answers 404 to a
   *  refetch of the page the user is sitting on. "Something went wrong" is a
   *  server fault and it is not one — nothing failed, the thing this page is about
   *  is simply gone, and the only useful next step is the way back to the list. */
  if (isError && isNotFoundError(error)) {
    return renderState(TriangleAlert, localize('com_ui_knowledge_error_not_found'));
  }

  if (isError || !collection) {
    return renderState(TriangleAlert, localize('com_ui_knowledge_error_generic'));
  }

  const createdAt = formatDate(collection.createdAt);
  const updatedAt = formatDate(collection.updatedAt);
  /** A `global` collection is readable by everyone but writable only by its
   *  owner, so retrieval stays available and every write control is withheld. */
  const canWrite = canWriteKnowledgeCollection(collection, user?.id);

  /** `null` is "not run yet" and must read differently from a run that matched
   *  nothing, so the two are kept apart rather than collapsed into an empty list. */
  const renderResults = () => {
    if (snippets == null) {
      return null;
    }
    if (snippets.length === 0) {
      return (
        <p className="mt-5 text-sm text-text-secondary">
          {localize('com_ui_knowledge_no_results')}
        </p>
      );
    }
    return (
      <ul className="mt-5 flex flex-col gap-3">
        {snippets.map((snippet, index) => (
          <li
            key={`${snippet.documentId}-${snippet.chunkIndex}-${index}`}
            className="rounded-xl border border-border-light bg-surface-primary p-3.5"
          >
            <p className="text-pretty text-sm leading-relaxed text-text-primary">{snippet.text}</p>
            <p className="mt-2 text-xs tabular-nums text-text-secondary">
              {localize('com_ui_knowledge_result_score', {
                score: snippet.score.toFixed(3),
              })}
            </p>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <main className="flex h-full min-h-0 flex-col overflow-y-auto bg-presentation text-text-primary">
      <header className="sticky top-0 z-10 border-b border-border-light bg-presentation">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 md:h-16 md:px-6">
          {isSmallScreen ? <OpenSidebar className="size-9 shrink-0" /> : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={goBack}
            className="-ml-1.5 text-text-secondary hover:text-text-primary"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {localize('com_ui_knowledge_back')}
          </Button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 pb-10 pt-6 md:px-6 md:pt-8">
        <section aria-labelledby={`${formId}-title`} className="flex flex-col gap-4">
          <div className="flex items-start gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface-secondary text-text-secondary">
              <ScanSearch className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <h1
                id={`${formId}-title`}
                className="truncate text-balance text-2xl font-semibold tracking-tight text-text-primary"
              >
                {collection.name}
              </h1>
              {collection.description ? (
                <p className="mt-1 text-pretty text-sm leading-relaxed text-text-secondary">
                  {collection.description}
                </p>
              ) : null}
            </div>
            {canWrite ? (
              <div className="flex shrink-0 items-center gap-0.5 pt-1">
                <TooltipAnchor
                  description={localize('com_ui_knowledge_edit_collection')}
                  render={
                    <Button
                      ref={editButtonRef}
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-text-secondary hover:text-text-primary"
                      aria-label={localize('com_ui_knowledge_edit_collection')}
                      onClick={() => setIsEditOpen(true)}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  }
                />
                <TooltipAnchor
                  description={localize('com_ui_knowledge_delete_collection')}
                  render={
                    <Button
                      ref={deleteButtonRef}
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="hover:text-destructive size-8 shrink-0 text-text-secondary"
                      aria-label={localize('com_ui_knowledge_delete_collection')}
                      onClick={() => setIsDeleteOpen(true)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  }
                />
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Chip>
              <span className="text-text-secondary">{localize('com_ui_knowledge_scope')}</span>
              {getKnowledgeScopeLabel(collection.scope, localize)}
            </Chip>
            <span className="flex items-baseline gap-2 text-xs tabular-nums text-text-secondary">
              <span className="font-medium text-text-primary">
                {localize('com_ui_knowledge_documents_count', {
                  count: collection.documentCount,
                })}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-text-primary">
                {localize('com_ui_knowledge_chunks_count', { count: collection.chunkCount })}
              </span>
            </span>
            {createdAt ? (
              <CollectionStat label={localize('com_ui_knowledge_created_at')} value={createdAt} />
            ) : null}
            {updatedAt ? (
              <CollectionStat label={localize('com_ui_knowledge_updated_at')} value={updatedAt} />
            ) : null}
          </div>
        </section>

        {canWrite ? (
          <KnowledgeEditDialog
            open={isEditOpen}
            onOpenChange={setIsEditOpen}
            collection={collection}
            triggerRef={editButtonRef}
          />
        ) : null}
        {canWrite ? (
          <KnowledgeDeleteDialog
            open={isDeleteOpen}
            onOpenChange={setIsDeleteOpen}
            collection={collection}
            triggerRef={deleteButtonRef}
          />
        ) : null}

        {canWrite ? (
          <section
            aria-labelledby={`${formId}-ingest-heading`}
            className="flex flex-col rounded-2xl border border-border-light bg-surface-secondary p-4 md:p-5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`${formId}-ingest-heading`} className="text-sm font-medium text-text-primary">
                {localize('com_ui_knowledge_add_document')}
              </h2>
              <p className="text-xs tabular-nums text-text-secondary">
                {localize('com_ui_knowledge_documents_count', { count: collection.documentCount })}
                <span aria-hidden="true"> · </span>
                {localize('com_ui_knowledge_chunks_count', { count: collection.chunkCount })}
              </p>
            </div>

            {/* What is left of the deployment-wide index, where the store reports it.
                Paired with the counts above because it is the other half of the same
                number: how much is indexed, and how much more can be. A store that
                reports nothing renders nothing rather than an "unknown", which would
                be indistinguishable from a store that is silently failing. */}
            {remainingChunks != null ? (
              <p
                className={cn(
                  'text-pretty text-xs',
                  remainingChunks === 0 ? 'text-destructive font-medium' : 'text-text-secondary',
                )}
              >
                {remainingChunks === 0
                  ? localize('com_ui_knowledge_capacity_full')
                  : localize('com_ui_knowledge_capacity_remaining', { count: remainingChunks })}
              </p>
            ) : null}

            <form
              id={`${formId}-ingest`}
              onSubmit={handleAddDocument}
              className="mt-4 flex flex-col gap-4"
            >
              <div className="space-y-2">
                <Label
                  htmlFor={`${formId}-content`}
                  className="text-sm font-medium text-text-primary"
                >
                  {localize('com_ui_knowledge_document_content')}
                </Label>
                <Textarea
                  id={`${formId}-content`}
                  value={documentDraft.content}
                  onChange={(event) =>
                    setDocumentDraft({ ...documentDraft, content: event.target.value })
                  }
                  placeholder={localize('com_ui_knowledge_document_content_placeholder')}
                  maxLength={KNOWLEDGE_CONTENT_MAX_LENGTH}
                  rows={6}
                />
                <p className="text-xs tabular-nums text-text-secondary">
                  {localize('com_ui_knowledge_character_count', {
                    current: documentDraft.content.length,
                    max: KNOWLEDGE_CONTENT_MAX_LENGTH,
                  })}
                </p>
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor={`${formId}-source`}
                  className="text-sm font-medium text-text-primary"
                >
                  {localize('com_ui_knowledge_document_source')}{' '}
                  <span className="font-normal text-text-secondary">
                    {localize('com_ui_optional')}
                  </span>
                </Label>
                <Input
                  id={`${formId}-source`}
                  value={documentDraft.source}
                  onChange={(event) =>
                    setDocumentDraft({ ...documentDraft, source: event.target.value })
                  }
                  placeholder={localize('com_ui_knowledge_document_source_placeholder')}
                  className="w-full"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  form={`${formId}-ingest`}
                  variant="submit"
                  disabled={
                    !documentDraft.content.trim() ||
                    documentDraft.content.length > KNOWLEDGE_CONTENT_MAX_LENGTH ||
                    addDocument.isLoading
                  }
                  className="active:scale-[0.96]"
                >
                  {addDocument.isLoading ? (
                    <Spinner className="size-4" />
                  ) : (
                    <FilePlus2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  {localize('com_ui_knowledge_add_document')}
                </Button>
              </div>
            </form>
          </section>
        ) : null}

        {!canWrite ? (
          /** Absence of controls is not an explanation: a `global` collection owned by
           *  someone else is fully usable for retrieval, and the user is otherwise
           *  left guessing whether the page failed to load, whether they are looking
           *  at someone else's collection by mistake, or whether the buttons are
           *  broken. Says what is missing and why, in text. */
          <p className="text-pretty rounded-2xl border border-border-light bg-surface-secondary p-4 text-sm text-text-secondary md:p-5">
            {localize('com_ui_knowledge_read_only_notice')}
          </p>
        ) : null}

        {canWrite ? (
          <section
            aria-labelledby={`${formId}-session`}
            className="flex flex-col rounded-2xl border border-border-light bg-surface-secondary p-4 md:p-5"
          >
            {/* A short heading names the region; the disclosure below it says why the
             *  list is empty after a reload. The hint used to *be* the heading, which
             *  made a four-line sentence the name of the region and left the region
             *  itself nameless. It stays on screen when the list is empty. */}
            <h2
              ref={sessionHeadingRef}
              id={`${formId}-session`}
              tabIndex={-1}
              className="text-sm font-medium text-text-primary outline-none"
            >
              {localize('com_ui_knowledge_session_documents')}
            </h2>
            <p className="mt-1 text-pretty text-sm leading-relaxed text-text-secondary">
              {localize('com_ui_knowledge_no_documents_hint')}
            </p>
            {ingestedDocuments.length === 0 ? null : (
              <ul className="mt-4 flex flex-col gap-2.5">
                {ingestedDocuments.map((entry) => {
                  const label = entry.source || entry.textPreview;
                  const isArmed = pendingDeleteId === entry.documentId;
                  return (
                    <li
                      key={`${entry.documentId}-${entry.addedAt}`}
                      className="flex items-start gap-3 rounded-xl border border-border-light bg-surface-primary p-3.5"
                    >
                      <FileText
                        className="mt-0.5 size-4 shrink-0 text-text-secondary"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text-primary">{label}</p>
                        {entry.source ? (
                          <p className="mt-0.5 text-pretty text-xs text-text-secondary">
                            {entry.textPreview}
                          </p>
                        ) : null}
                        <p className="mt-1.5 text-xs tabular-nums text-text-secondary">
                          {localize('com_ui_knowledge_chunks_count', { count: entry.chunkCount })}
                        </p>
                      </div>
                      {isArmed ? (
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            ref={cancelDeleteButtonRef}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPendingDeleteId(null)}
                          >
                            {localize('com_ui_cancel')}
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={deleteDocument.isLoading}
                            onClick={() => handleDeleteDocument(entry)}
                          >
                            {deleteDocument.isLoading ? <Spinner className="size-4" /> : null}
                            {localize('com_ui_knowledge_delete')}
                          </Button>
                        </div>
                      ) : (
                        <TooltipAnchor
                          description={localize('com_ui_knowledge_delete')}
                          render={
                            <Button
                              ref={registerDeleteTrigger(entry.documentId)}
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="hover:text-destructive size-8 shrink-0 text-text-secondary"
                              aria-label={`${localize('com_ui_knowledge_delete')}: ${label}`}
                              onClick={() => armDelete(entry.documentId)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          }
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

        <section
          aria-labelledby={`${formId}-retrieve-heading`}
          className="flex flex-col rounded-2xl border border-border-light bg-surface-secondary p-4 md:p-5"
        >
          <h2 id={`${formId}-retrieve-heading`} className="text-sm font-medium text-text-primary">
            {localize('com_ui_knowledge_test_query')}
          </h2>
          <p className="mt-1 text-pretty text-sm text-text-secondary">
            {localize('com_ui_knowledge_test_query_description')}
          </p>

          <form
            id={`${formId}-retrieve`}
            onSubmit={handleRunQuery}
            className="mt-4 flex flex-col gap-4"
          >
            <div className="space-y-2">
              <Label htmlFor={`${formId}-query`} className="text-sm font-medium text-text-primary">
                {localize('com_ui_search_query')}
              </Label>
              <Input
                id={`${formId}-query`}
                value={retrieveQuery}
                onChange={(event) => setRetrieveQuery(event.target.value)}
                placeholder={localize('com_ui_knowledge_test_query_placeholder')}
                maxLength={KNOWLEDGE_QUERY_MAX_UNITS}
                aria-invalid={isQueryTooLong}
                aria-describedby={isQueryTooLong ? `${formId}-query-error` : undefined}
                className="w-full"
              />
              {isQueryTooLong ? (
                <p id={`${formId}-query-error`} role="alert" className="text-destructive text-xs">
                  {localize('com_ui_knowledge_query_too_long', { max: KNOWLEDGE_QUERY_MAX_LENGTH })}
                </p>
              ) : null}
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                form={`${formId}-retrieve`}
                variant="submit"
                disabled={!retrieveQuery.trim() || isQueryTooLong || retrieve.isLoading}
                className="active:scale-[0.96]"
              >
                {retrieve.isLoading ? <Spinner className="size-4" /> : null}
                {localize('com_ui_knowledge_run')}
              </Button>
            </div>
          </form>

          {renderResults()}
        </section>
      </div>
    </main>
  );
}
