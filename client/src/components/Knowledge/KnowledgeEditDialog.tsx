import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import {
  Button,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  Radio,
  Spinner,
  Textarea,
  useToastContext,
} from '@librechat/client';
import type { TKnowledgeCollection, TKnowledgeCollectionScope } from 'librechat-data-provider';
import {
  useUpdateKnowledgeCollectionMutation,
  isKnowledgeNameTooLong,
  isKnowledgeDescriptionTooLong,
  KNOWLEDGE_DESCRIPTION_MAX_UNITS,
  KNOWLEDGE_NAME_MAX_LENGTH,
  KNOWLEDGE_NAME_MAX_UNITS,
} from '~/data-provider';
import { useKnowledgeScopeOptions } from './KnowledgeCreateDialog';
import { getKnowledgeErrorMessage } from './errors';
import { useLocalize } from '~/hooks';

type KnowledgeEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: TKnowledgeCollection;
  /**
   * The control that opened this dialog, so focus returns there on close. The
   * list card opens this from a row menu, and a menu item is unmounted the moment
   * the menu closes, so `OGDialog`'s default restore targets a detached node and
   * focus lands on `<body>`. See `KnowledgeDeleteDialog`.
   */
  triggerRef?: RefObject<HTMLButtonElement | null>;
};

export default function KnowledgeEditDialog({
  open,
  onOpenChange,
  collection,
  triggerRef,
}: KnowledgeEditDialogProps) {
  const localize = useLocalize();
  const formId = useId();
  const scopeLabelId = `${formId}-scope-label`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(collection.name);
  const [description, setDescription] = useState(collection.description ?? '');
  const [scope, setScope] = useState<TKnowledgeCollectionScope>(collection.scope);
  const [wasOpen, setWasOpen] = useState(open);
  const updateCollection = useUpdateKnowledgeCollectionMutation();
  const { showToast } = useToastContext();
  const scopeOptions = useKnowledgeScopeOptions();
  /** `isLoading` only reaches the button on the next render, so a second click
   *  inside that window put the same PATCH through twice — a rename and an
   *  un-share in two requests, with two toasts. This latch is synchronous. */
  const isSubmitting = useRef(false);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(collection.name);
      setDescription(collection.description ?? '');
      setScope(collection.scope);
      isSubmitting.current = false;
    }
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    const frameId = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frameId);
  }, [open]);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const isNameTooLong = isKnowledgeNameTooLong(name);
  const isDescriptionTooLong = isKnowledgeDescriptionTooLong(description);
  const nameErrorId = `${formId}-name-error`;
  /** A stored scope this user cannot apply — `global` on a collection they do not
   *  own, or a scope the control does not offer (see `KNOWLEDGE_SCOPE_CHOICES`) —
   *  selects no segment, and `PATCH /:id` `$set`s every key it is given, so sending
   *  it would either 403 or silently rewrite the stored scope to whatever the user
   *  happened to click next. Omitting the key leaves it exactly as stored. */
  const isScopeSelectable = scopeOptions.some((option) => option.value === scope);
  /** Whether the scope can be moved at all: some offered scope is not the one
   *  stored. This — not the length of the list — is what the control is for. */
  const isScopeMovable = scopeOptions.some((option) => option.value !== scope);
  const isUnchanged =
    trimmedName === collection.name &&
    trimmedDescription === (collection.description ?? '').trim() &&
    (!isScopeSelectable || scope === collection.scope);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !trimmedName ||
      isNameTooLong ||
      isDescriptionTooLong ||
      isUnchanged ||
      isSubmitting.current ||
      updateCollection.isLoading
    ) {
      return;
    }

    isSubmitting.current = true;
    /** `description` is always sent, empty included: the route `$set`s every key it
     *  is given, so omitting it would make clearing a description impossible. */
    updateCollection.mutate(
      {
        id: collection.id,
        name: trimmedName,
        description: trimmedDescription,
        ...(isScopeSelectable ? { scope } : {}),
      },
      {
        onSuccess: () => {
          isSubmitting.current = false;
          showToast({
            message: localize('com_ui_knowledge_collection_updated'),
            status: 'success',
          });
          onOpenChange(false);
        },
        onError: (updateError) => {
          isSubmitting.current = false;
          /** The dialog stays open with its edits intact, so the same change can be
           *  submitted again rather than retyped. */
          showToast({
            message: getKnowledgeErrorMessage(updateError, localize),
            status: 'error',
          });
        },
      },
    );
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      <OGDialogTemplate
        title={localize('com_ui_knowledge_edit_collection')}
        description={localize('com_ui_knowledge_edit_dialog_description')}
        showCloseButton={false}
        className="w-11/12 max-w-md"
        main={
          <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-name`} className="text-sm font-medium text-text-primary">
                {localize('com_ui_knowledge_name')}
              </Label>
              <Input
                id={`${formId}-name`}
                ref={inputRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={localize('com_ui_knowledge_name_placeholder')}
                maxLength={KNOWLEDGE_NAME_MAX_UNITS}
                className="w-full"
                aria-invalid={isNameTooLong}
                aria-describedby={isNameTooLong ? nameErrorId : undefined}
              />
              {isNameTooLong ? (
                <p id={nameErrorId} className="text-destructive text-xs" role="alert">
                  {localize('com_ui_knowledge_name_too_long', { max: KNOWLEDGE_NAME_MAX_LENGTH })}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label
                htmlFor={`${formId}-description`}
                className="text-sm font-medium text-text-primary"
              >
                {localize('com_ui_knowledge_description_label')}{' '}
                <span className="font-normal text-text-secondary">
                  {localize('com_ui_optional')}
                </span>
              </Label>
              <Textarea
                id={`${formId}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={localize('com_ui_knowledge_description_placeholder')}
                maxLength={KNOWLEDGE_DESCRIPTION_MAX_UNITS}
                rows={3}
                className="min-h-[4.5rem] bg-transparent"
              />
            </div>
            {/* Rendered when the scope can actually be moved — when some offered
                scope is not the one stored — rather than when the list has more than
                one entry. A non-admin editing a `private` collection is offered
                `private` alone and so has nothing to move to: a single unchangeable
                segment is not a control. A non-admin who *owns* a `global` collection
                is offered the same single `private` option against a stored scope it
                is not, and that difference is the whole case — it is the only exit
                from sharing, which the server allows for any role
                (`canUseScope` gates `global`, not narrowing away from it), and
                withholding the control for it left such a collection un-shareable
                from the UI for good. A create dialog has no stored scope to differ
                from, so it keeps the "more than one choice" rule. */}
            {isScopeMovable ? (
              <div className="space-y-2">
                <Label id={scopeLabelId} className="text-sm font-medium text-text-primary">
                  {localize('com_ui_knowledge_scope')}
                </Label>
                <Radio
                  aria-labelledby={scopeLabelId}
                  value={scope}
                  onChange={(value) => setScope(value as TKnowledgeCollectionScope)}
                  options={scopeOptions}
                  fullWidth={true}
                />
              </div>
            ) : null}
          </form>
        }
        buttons={
          <Button
            type="submit"
            form={formId}
            variant="submit"
            disabled={
              !trimmedName ||
              isNameTooLong ||
              isDescriptionTooLong ||
              isUnchanged ||
              updateCollection.isLoading
            }
            aria-label={localize('com_ui_knowledge_save')}
            className="active:scale-[0.96]"
          >
            {updateCollection.isLoading ? (
              <Spinner className="size-4" />
            ) : (
              localize('com_ui_knowledge_save')
            )}
          </Button>
        }
      />
    </OGDialog>
  );
}
