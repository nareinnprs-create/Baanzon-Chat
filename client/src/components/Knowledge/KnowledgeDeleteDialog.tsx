import { type RefObject } from 'react';
import { useSetAtom } from 'jotai';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Button,
  Spinner,
  OGDialog,
  OGDialogClose,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  OGDialogDescription,
  useToastContext,
} from '@librechat/client';
import type { TKnowledgeCollection } from 'librechat-data-provider';
import { useDeleteKnowledgeCollectionMutation } from '~/data-provider';
import { knowledgeSelectedCollectionIdAtom } from './state';
import { getKnowledgeErrorMessage } from './errors';
import { useLocalize } from '~/hooks';

type KnowledgeDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: TKnowledgeCollection;
  /**
   * The control that opened this dialog, so focus returns there on close.
   *
   * `OGDialog` restores focus to whatever was focused when it opened, which is the
   * right default and not always right here: the workspace's own trigger is stable,
   * but the list card opens this from a row menu, and a menu item is unmounted the
   * moment the menu closes — so the restore targets a detached node and focus falls
   * to `<body>`. Passing the trigger explicitly makes the destination a decision
   * instead of an accident.
   */
  triggerRef?: RefObject<HTMLButtonElement | null>;
};

export default function KnowledgeDeleteDialog({
  open,
  onOpenChange,
  collection,
  triggerRef,
}: KnowledgeDeleteDialogProps) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const location = useLocation();
  const deleteCollection = useDeleteKnowledgeCollectionMutation();
  const { showToast } = useToastContext();
  const setSelectedCollectionId = useSetAtom(knowledgeSelectedCollectionIdAtom);

  const confirmDelete = () => {
    deleteCollection.mutate(collection.id, {
      onSuccess: () => {
        showToast({
          message: localize('com_ui_knowledge_collection_deleted'),
          status: 'success',
        });
        onOpenChange(false);
        /** The list highlights the card named by this atom, so a deleted collection
         *  left selected meant the next visit to the list highlighted nothing while
         *  the detail route still resolved an id that no longer exists. */
        setSelectedCollectionId(null);
        if (location.pathname === `/knowledge/${collection.id}`) {
          navigate('/knowledge');
        }
      },
      onError: (deleteError) => {
        /** Deliberately not closing: the collection is still there, so the confirm
         *  button stays live and the delete can simply be tried again. */
        showToast({
          message: getKnowledgeErrorMessage(deleteError, localize),
          status: 'error',
        });
      },
    });
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      <OGDialogContent className="w-11/12 max-w-md" showCloseButton={false}>
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_ui_knowledge_confirm_delete_title')}</OGDialogTitle>
        </OGDialogHeader>
        {/* Not decoration: without a description Radix leaves the dialog with no
            `aria-describedby`, so a screen reader announced only "Delete this
            collection?" — the sentence naming the collection and saying it is
            permanent is the part that makes it a decision rather than a guess. */}
        <OGDialogDescription className="text-sm text-text-secondary">
          {localize('com_ui_knowledge_confirm_delete_description', { name: collection.name })}
        </OGDialogDescription>
        <div className="flex justify-end gap-4 pt-4">
          <OGDialogClose asChild>
            <Button aria-label={localize('com_ui_cancel')} variant="outline">
              {localize('com_ui_cancel')}
            </Button>
          </OGDialogClose>
          <Button
            variant="destructive"
            onClick={confirmDelete}
            disabled={deleteCollection.isLoading}
            aria-label={localize('com_ui_knowledge_delete')}
          >
            {deleteCollection.isLoading ? (
              <Spinner className="size-4" />
            ) : (
              localize('com_ui_knowledge_delete')
            )}
          </Button>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
