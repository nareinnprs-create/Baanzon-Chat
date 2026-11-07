import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dataService, MutationKeys, QueryKeys } from 'librechat-data-provider';
import type {
  TKnowledgeAddDocumentRequest,
  TKnowledgeCollection,
  TKnowledgeCollectionResponse,
  TKnowledgeCreateRequest,
  TKnowledgeDeletedResponse,
  TKnowledgeDocumentResponse,
  TKnowledgeRetrieveRequest,
  TKnowledgeRetrieveResponse,
  TKnowledgeUpdateRequest,
  TKnowledgeUpdateResponse,
} from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import { isNotFoundError } from '~/utils/errors';

/**
 * The list query's key, matched exactly.
 *
 * The availability probe is `[knowledgeCollections, 'availability']` — a prefix
 * match on the bare key reaches it, so every collection mutation used to refetch
 * the probe as a side effect. The probe exists to answer one question about
 * `rag.disabled` and revalidates on mount and focus already; making four
 * unrelated write paths (create, update, delete, ingest, document delete) re-run
 * it is a request per mutation that decides nothing the mutation changed.
 */
const KNOWLEDGE_LIST_KEY = [QueryKeys.knowledgeCollections] as const;

/**
 * A 404 from a delete is the state the caller asked for.
 *
 * A stale view (the collection was deleted in another tab, or an admin removed
 * it) answers 404, and treating that as a failure showed the server's bare "Not
 * Found" and then still ran the success path — a toast saying the opposite
 * moments later, or a redirect away from a page that was already gone. Absent is
 * deleted, so the 404 is resolved into the success shape here rather than in
 * each caller: one place decides, and every consumer's `onSuccess` (cache
 * invalidation, the un-share, the redirect) runs exactly as it does for a 200.
 */
const resolveDelete = async (
  run: () => Promise<TKnowledgeDeletedResponse>,
): Promise<TKnowledgeDeletedResponse> => {
  try {
    return await run();
  } catch (error) {
    if (isNotFoundError(error)) {
      return { deleted: true };
    }
    throw error;
  }
};

export const useCreateKnowledgeCollectionMutation = (): UseMutationResult<
  TKnowledgeCollection,
  unknown,
  TKnowledgeCreateRequest,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: TKnowledgeCreateRequest) => dataService.createKnowledgeCollection(payload),
    {
      mutationKey: [MutationKeys.createKnowledgeCollection],
      onSuccess: (collection) => {
        /** Detail cache holds the `{ collection }` envelope; creation returns it bare. */
        queryClient.setQueryData<TKnowledgeCollectionResponse>(
          [QueryKeys.knowledgeCollection, collection.id],
          { collection },
        );
        queryClient.invalidateQueries(KNOWLEDGE_LIST_KEY, { exact: true });
      },
    },
  );
};

export const useUpdateKnowledgeCollectionMutation = (): UseMutationResult<
  TKnowledgeUpdateResponse,
  unknown,
  TKnowledgeUpdateRequest,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: TKnowledgeUpdateRequest) => dataService.updateKnowledgeCollection(payload),
    {
      mutationKey: [MutationKeys.updateKnowledgeCollection],
      onSuccess: (result) => {
        /** The update response is already the detail cache's shape. */
        queryClient.setQueryData<TKnowledgeCollectionResponse>(
          [QueryKeys.knowledgeCollection, result.collection.id],
          result,
        );
        queryClient.invalidateQueries(KNOWLEDGE_LIST_KEY, { exact: true });
      },
    },
  );
};

export const useDeleteKnowledgeCollectionMutation = (): UseMutationResult<
  TKnowledgeDeletedResponse,
  unknown,
  string,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    (collectionId: string) =>
      resolveDelete(() => dataService.deleteKnowledgeCollection(collectionId)),
    {
      mutationKey: [MutationKeys.deleteKnowledgeCollection],
      onSuccess: (_result, collectionId) => {
        // Invalidate so an *active* detail observer refetches and settles into a
        // not-found state. (Removing it instead leaves observers stuck loading under
        // `refetchOnMount: false`.)
        queryClient.invalidateQueries([QueryKeys.knowledgeCollection, collectionId]);
        // Drop any *inactive* cached detail so a later visit to the deleted collection
        // refetches (→ not-found) rather than rendering stale cache within `cacheTime`.
        queryClient.removeQueries([QueryKeys.knowledgeCollection, collectionId], {
          type: 'inactive',
        });
        queryClient.invalidateQueries(KNOWLEDGE_LIST_KEY, { exact: true });
      },
    },
  );
};

export const useAddKnowledgeDocumentMutation = (): UseMutationResult<
  TKnowledgeDocumentResponse,
  unknown,
  { collectionId: string } & TKnowledgeAddDocumentRequest,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ collectionId, ...payload }: { collectionId: string } & TKnowledgeAddDocumentRequest) =>
      dataService.addKnowledgeDocument(collectionId, payload),
    {
      mutationKey: [MutationKeys.addKnowledgeDocument],
      onSuccess: (_result, variables) => {
        /** Ingest changes `documentCount`/`chunkCount`, which only the detail carries. */
        queryClient.invalidateQueries([QueryKeys.knowledgeCollection, variables.collectionId]);
        queryClient.invalidateQueries(KNOWLEDGE_LIST_KEY, { exact: true });
      },
    },
  );
};

export const useDeleteKnowledgeDocumentMutation = (): UseMutationResult<
  TKnowledgeDeletedResponse,
  unknown,
  { collectionId: string; documentId: string },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ collectionId, documentId }: { collectionId: string; documentId: string }) =>
      resolveDelete(() => dataService.deleteKnowledgeDocument(collectionId, documentId)),
    {
      mutationKey: [MutationKeys.deleteKnowledgeDocument],
      onSuccess: (_result, variables) => {
        /** There is no list-documents query to invalidate — a `documentId` exists only
         *  in the ingest response — so the collection's counters are the only surface
         *  that can go stale. */
        queryClient.invalidateQueries([QueryKeys.knowledgeCollection, variables.collectionId]);
        queryClient.invalidateQueries(KNOWLEDGE_LIST_KEY, { exact: true });
      },
    },
  );
};

/** Retrieval is a POST but a read: it mutates nothing, so no cache is touched. */
export const useRetrieveKnowledgeMutation = (): UseMutationResult<
  TKnowledgeRetrieveResponse,
  unknown,
  TKnowledgeRetrieveRequest,
  unknown
> => {
  return useMutation(
    (payload: TKnowledgeRetrieveRequest) =>
      dataService.retrieveKnowledge(payload.collectionId, payload),
    {
      mutationKey: [MutationKeys.retrieveKnowledge],
    },
  );
};
