import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAtom } from 'jotai';
import * as Ariakit from '@ariakit/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Chip, EmptyState, FilterInput, Skeleton, DropdownPopup } from '@librechat/client';
import { Ellipsis, LibraryBig, Pencil, Plus, PowerOff, Trash2, TriangleAlert } from 'lucide-react';
import type { TKnowledgeCollection } from 'librechat-data-provider';
import type { MenuItemProps } from '~/common';
import {
  isKnowledgeDisabledError,
  useKnowledgeCollectionsQuery,
  useKnowledgeCollectionsEnabledQuery,
} from '~/data-provider';
import {
  knowledgeSearchAtom,
  knowledgeSelectedCollectionIdAtom,
  canWriteKnowledgeCollection,
} from './state';
import KnowledgeCreateDialog, { getKnowledgeScopeLabel } from './KnowledgeCreateDialog';
import KnowledgeDeleteDialog from './KnowledgeDeleteDialog';
import KnowledgeEditDialog from './KnowledgeEditDialog';
import { useAuthContext, useLocalize } from '~/hooks';
import KnowledgeNavBar from './KnowledgeNavBar';
import { cn } from '~/utils';

function KnowledgeCard({
  collection,
  isActive,
  canWrite,
  onOpen,
}: {
  collection: TKnowledgeCollection;
  isActive: boolean;
  canWrite: boolean;
  onOpen: (collectionId: string) => void;
}) {
  const localize = useLocalize();
  const menuId = useId();
  /** Both card dialogs restore focus here: the menu item that opened them is
   *  unmounted when the menu closes, so it cannot be the restore target. */
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const menuItems = useMemo<MenuItemProps[]>(
    () => [
      {
        id: `${menuId}-edit`,
        label: localize('com_ui_knowledge_edit_collection'),
        icon: <Pencil className="size-4 text-text-secondary" aria-hidden="true" />,
        onClick: () => setIsEditOpen(true),
      },
      {
        id: `${menuId}-delete`,
        label: localize('com_ui_knowledge_delete_collection'),
        icon: <Trash2 className="size-4 text-text-secondary" aria-hidden="true" />,
        onClick: () => setIsDeleteOpen(true),
      },
    ],
    [localize, menuId],
  );

  return (
    <article
      className={cn(
        'group/knowledge relative flex min-h-[11rem] flex-col rounded-2xl border border-border-light bg-surface-secondary',
        'transition-colors duration-150 ease-out hover:bg-surface-hover',
        isActive && 'ring-1 ring-text-primary',
      )}
    >
      <button
        type="button"
        aria-current={isActive ? 'true' : undefined}
        className="flex min-h-[11rem] flex-1 flex-col rounded-2xl p-4 pr-12 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-primary"
        onClick={() => onOpen(collection.id)}
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-tertiary text-text-secondary transition-colors group-hover/knowledge:text-text-primary">
          <LibraryBig className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="mt-3 truncate text-base font-semibold tracking-tight text-text-primary">
          {collection.name}
        </span>
        {collection.description ? (
          <span className="mt-1 line-clamp-2 text-pretty text-sm leading-relaxed text-text-secondary">
            {collection.description}
          </span>
        ) : null}
        <span className="mt-auto flex flex-wrap items-center gap-2 pt-4 text-xs tabular-nums text-text-secondary">
          <Chip>
            <span className="text-text-secondary">{localize('com_ui_knowledge_scope')}</span>
            {getKnowledgeScopeLabel(collection.scope, localize)}
          </Chip>
          <span>
            {localize('com_ui_knowledge_documents_count', { count: collection.documentCount })}
          </span>
          <span aria-hidden="true">·</span>
          <span>{localize('com_ui_knowledge_chunks_count', { count: collection.chunkCount })}</span>
        </span>
      </button>
      {/* A card the user cannot write has no menu at all: the menu held only Edit and
          Delete, both of which 403 for a non-owner, so keeping the trigger would
          offer two actions that cannot succeed. Opening the card still works — the
          collection is readable, and retrieval is the reason to be here. */}
      <div className="absolute right-2 top-2">
        {canWrite ? (
          <DropdownPopup
            portal={true}
            focusLoop={true}
            unmountOnHide={true}
            menuId={menuId}
            isOpen={isMenuOpen}
            setIsOpen={setIsMenuOpen}
            className="z-[125] min-w-44"
            iconClassName="mr-2 text-text-secondary"
            trigger={
              <Ariakit.MenuButton
                ref={menuButtonRef}
                aria-label={localize('com_ui_more_options')}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary outline-none transition-colors',
                  'hover:bg-surface-tertiary hover:text-text-primary',
                  'focus-visible:ring-2 focus-visible:ring-text-primary',
                  isMenuOpen && 'bg-surface-tertiary text-text-primary',
                )}
              >
                <Ellipsis className="h-4 w-4" aria-hidden="true" />
              </Ariakit.MenuButton>
            }
            items={menuItems}
          />
        ) : null}
      </div>
      {canWrite ? (
        <KnowledgeEditDialog
          open={isEditOpen}
          onOpenChange={setIsEditOpen}
          collection={collection}
          triggerRef={menuButtonRef}
        />
      ) : null}
      {canWrite ? (
        <KnowledgeDeleteDialog
          open={isDeleteOpen}
          onOpenChange={setIsDeleteOpen}
          collection={collection}
          triggerRef={menuButtonRef}
        />
      ) : null}
    </article>
  );
}

function KnowledgeGridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="flex min-h-[11rem] flex-col rounded-2xl bg-surface-secondary p-4"
        >
          <Skeleton className="h-11 w-11 rounded-xl" />
          <Skeleton className="mt-3 h-5 w-2/3" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-auto h-6 w-32" />
        </div>
      ))}
    </div>
  );
}

/**
 * A page-level state, announced rather than merely drawn.
 *
 * Each of these branches replaces everything the page was showing, so a screen
 * reader that is never told about them is left with a `<main>` that went blank and
 * no reason why. `alert` for the failure and the kill switch (something the user
 * has to act on interrupts), `status` for the informational ones.
 */
function AnnouncedState({ assertive, children }: { assertive?: boolean; children: ReactNode }) {
  return <div role={assertive ? 'alert' : 'status'}>{children}</div>;
}

export default function KnowledgeView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useAtom(knowledgeSearchAtom);
  const [selectedCollectionId, setSelectedCollectionId] = useAtom(
    knowledgeSelectedCollectionIdAtom,
  );
  const [isCreating, setIsCreating] = useState(searchParams.get('new') === '1');
  const deferredSearch = useDeferredValue(search);
  const listHeadingId = useId();

  const {
    data,
    isLoading,
    isError,
    isFetching,
    error: collectionsError,
    refetch,
  } = useKnowledgeCollectionsQuery();
  /** The kill switch is per-request 503, so the probe is what reports it. The list
   *  query answers the same status, but branching on the two together keeps the UI
   *  from growing a message-matching path. */
  const { error: availabilityError } = useKnowledgeCollectionsEnabledQuery();
  /** Either request answering 503 means `rag.disabled` is on, so the flag is their
   *  union: deciding from the probe alone left a 503 on the list rendering a full,
   *  interactive page whose every action then answered 503 too. */
  const isDisabled =
    isKnowledgeDisabledError(collectionsError) || isKnowledgeDisabledError(availabilityError);

  const collections = useMemo(() => data?.collections ?? [], [data?.collections]);
  const visibleCollections = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();
    if (!term) {
      return collections;
    }
    return collections.filter(
      (collection) =>
        collection.name.toLowerCase().includes(term) ||
        collection.description?.toLowerCase().includes(term),
    );
  }, [collections, deferredSearch]);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setIsCreating(true);
    }
  }, [searchParams]);

  /** `?new=1` cannot be honoured while the kill switch is on, so it is dropped
   *  rather than left in the address bar: a parameter that would open a fully
   *  enabled create form over a page whose every request answers 503, and that
   *  would spring open later with no user action once an admin re-enabled the
   *  feature. `open` is separately gated below because this effect lands a
   *  render after the first one, and the dialog would flash in between. */
  useEffect(() => {
    if (!isDisabled) {
      return;
    }
    setIsCreating(false);
    if (searchParams.get('new') === '1') {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('new');
      setSearchParams(nextParams, { replace: true });
    }
  }, [isDisabled, searchParams, setSearchParams]);

  /** The filter is a client-side view over the loaded list, and the atom outlives
   *  the route — a term typed once left every later visit to this page silently
   *  filtered, with nothing in the URL and no hint that it had happened. */
  useEffect(() => {
    return () => {
      setSearch('');
    };
  }, [setSearch]);

  const handleCreateDialogChange = (open: boolean) => {
    setIsCreating(open);
    if (!open && searchParams.get('new') === '1') {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('new');
      setSearchParams(nextParams, { replace: true });
    }
  };

  const openCollection = (collectionId: string) => {
    setSelectedCollectionId(collectionId);
    navigate(`/knowledge/${collectionId}`);
  };

  const hasCollections = collections.length > 0;

  return (
    <main className="flex h-full min-h-0 flex-col overflow-auto bg-presentation text-text-primary">
      <KnowledgeNavBar onCreate={() => setIsCreating(true)} isDisabled={isDisabled} />

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-10 pt-6 md:px-6 md:pt-8">
        {hasCollections ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <FilterInput
                inputId="knowledge-search"
                label={localize('com_ui_knowledge_search')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                containerClassName="w-full"
                /** `search`, not the default `text`: it is a search box, so it gets
                 *  the role assistive tech keys off and the browser's own clear
                 *  affordance, which is the only cheap way out of a filter that
                 *  hides every card. */
                type="search"
              />
            </div>
          </div>
        ) : null}

        <div className="mt-8 flex items-baseline justify-between gap-3">
          <h2 id={listHeadingId} className="text-sm font-medium text-text-primary">
            {localize('com_ui_knowledge_collections')}
          </h2>
          {!isLoading && !isError && hasCollections ? (
            <p className="text-sm tabular-nums text-text-secondary">{collections.length}</p>
          ) : null}
        </div>

        <KnowledgeCreateDialog
          /** Gated as well as the effect above: `isCreating` is initialised from
           *  `?new=1` before the probe has answered, and the dialog used to render
           *  a live create form on a page whose every request answers 503. */
          open={isCreating && !isDisabled}
          onOpenChange={handleCreateDialogChange}
          onCreated={(collection) => openCollection(collection.id)}
        />

        <div className="mt-4 flex flex-1 flex-col">
          {isDisabled ? (
            <AnnouncedState assertive={true}>
              <EmptyState
                icon={PowerOff}
                description={localize('com_ui_knowledge_error_disabled')}
                className="py-16"
              />
            </AnnouncedState>
          ) : null}

          {!isDisabled && isLoading && <KnowledgeGridSkeleton />}

          {!isDisabled && !isLoading && isError ? (
            <AnnouncedState assertive={true}>
              <EmptyState
                icon={TriangleAlert}
                description={localize('com_ui_knowledge_error_generic')}
                className="py-16"
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                    {localize('com_ui_retry')}
                  </Button>
                }
              />
            </AnnouncedState>
          ) : null}

          {!isDisabled && !isLoading && !isError && !hasCollections ? (
            <AnnouncedState>
              <EmptyState
                icon={LibraryBig}
                title={localize('com_ui_knowledge_no_collections')}
                description={localize('com_ui_knowledge_no_collections_description')}
                className="py-16"
                action={
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() => setIsCreating(true)}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    {localize('com_ui_knowledge_create_collection')}
                  </Button>
                }
              />
            </AnnouncedState>
          ) : null}

          {!isDisabled && !isLoading && !isError && hasCollections && !visibleCollections.length ? (
            <AnnouncedState>
              <EmptyState
                icon={LibraryBig}
                title={localize('com_ui_knowledge_no_matching_collections')}
                description={localize('com_ui_knowledge_no_matching_collections_description')}
                className="py-16"
              />
            </AnnouncedState>
          ) : null}

          {!isDisabled && !isLoading && visibleCollections.length > 0 ? (
            <section aria-labelledby={listHeadingId}>
              <div
                className={cn(
                  'grid gap-3 transition-opacity duration-150 sm:grid-cols-2 xl:grid-cols-3',
                  isFetching && 'opacity-60',
                )}
              >
                {visibleCollections.map((collection) => (
                  <KnowledgeCard
                    key={collection.id}
                    collection={collection}
                    isActive={selectedCollectionId === collection.id}
                    canWrite={canWriteKnowledgeCollection(collection, user?.id)}
                    onOpen={openCollection}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
