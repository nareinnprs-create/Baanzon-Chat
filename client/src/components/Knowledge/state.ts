import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { TKnowledgeCollection, TKnowledgeSnippet } from 'librechat-data-provider';

/**
 * Feature-owned UI state for the knowledge surface.
 *
 * Only view state lives here — what is selected, what has been typed, which
 * section is open. Collections, counters and retrieval results are server data
 * and belong to the React Query cache (`useKnowledgeCollectionsQuery` and
 * friends), so nothing below mirrors a query result. These atoms are colocated
 * with the components that read and write them and are deliberately memory-only:
 * a draft is a keystroke buffer, not a preference, and the app has no
 * `Provider` around Jotai's default store.
 */

/**
 * Whether the signed-in user may write to a collection, i.e. rename it, retarget
 * its scope, delete it, ingest into it or delete one of its documents.
 *
 * The server's rule is ownership and nothing else — `canWriteCollection` in
 * `packages/api/src/rag/authorization.ts` is `collection.userId === userId`,
 * and the list endpoint hands back every `global` collection in the deployment,
 * not just the caller's own. A `global` collection owned by somebody else is
 * therefore readable (retrieval genuinely works) but every write against it
 * answers 403, so the client has to withhold the write controls rather than
 * offer three actions that cannot succeed.
 *
 * A missing `currentUserId` — the auth context not resolved yet — is treated as
 * "cannot write", because a write control that is briefly wrong is a 403 the
 * user has to read, and a control that is briefly absent costs nothing.
 */
export function canWriteKnowledgeCollection(
  collection: TKnowledgeCollection,
  currentUserId?: string | null,
): boolean {
  return !!currentUserId && collection.userId === currentUserId;
}

/** The ingest draft for one collection: the text to index and its optional source label. */
export type KnowledgeDocumentDraft = {
  content: string;
  source: string;
};

export const EMPTY_DOCUMENT_DRAFT: KnowledgeDocumentDraft = { content: '', source: '' };

/**
 * The collection the user is on, shared between the list (which marks the active
 * card) and the workspace (which publishes the collection it is showing). Both
 * writer and reader live in this feature, so the state is feature-owned rather
 * than a global the two views reach for. The id itself stays in the URL — this
 * only exists so the list can highlight a card it did not navigate from.
 */
export const knowledgeSelectedCollectionIdAtom = atom<string | null>(null);

/** Client-side filter over the already-fetched collection list. */
export const knowledgeSearchAtom = atom<string>('');

/**
 * The ingest form's draft, per collection. A failed ingest keeps the text so it
 * can be resubmitted, and keying by id means switching collections and back
 * does not lose a half-written document.
 */
export const knowledgeDocumentDraftFamily = atomFamily((_collectionId: string) =>
  atom<KnowledgeDocumentDraft>({ ...EMPTY_DOCUMENT_DRAFT }),
);

/** The "test retrieval" question, per collection, for the same reason. */
export const knowledgeRetrieveQueryFamily = atomFamily((_collectionId: string) => atom<string>(''));

/**
 * A document this session ingested, remembered so it can still be deleted.
 *
 * `POST /:collectionId/documents` is the only response in the API that ever
 * contains a `documentId`, and there is no list endpoint to read one back, so
 * after a reload a collection's documents are genuinely unaddressable. Keeping
 * the ingest result is therefore not a mirror of server data — it is the only
 * copy of the id that will ever exist on the client, and holding it is what
 * gives `DELETE /:collectionId/documents/:documentId` a frontend entry point.
 * The workspace says as much on screen; this list is a log of the session, not
 * the collection's contents. The server's `documentCount`/`chunkCount` remain
 * the authoritative totals.
 */
export type KnowledgeIngestedDocument = {
  documentId: string;
  chunkCount: number;
  /** The label the user typed, kept verbatim; may be empty. */
  source: string;
  /** A short excerpt of what was actually indexed, for a row with no source. */
  textPreview: string;
  addedAt: number;
};

export const knowledgeIngestedDocumentsFamily = atomFamily((_collectionId: string) =>
  atom<KnowledgeIngestedDocument[]>([]),
);

/**
 * The passages the last test query returned, per collection.
 *
 * Retrieval is a POST, so there is no query cache to read a result back from —
 * but a run should not evaporate because the user opened the rename dialog and
 * the workspace remounted, so the answer is kept as view state until the next run.
 * `null` means "not run yet", which is distinct from a run that matched nothing.
 */
export const knowledgeRetrieveResultsFamily = atomFamily((_collectionId: string) =>
  atom<TKnowledgeSnippet[] | null>(null),
);
