import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { SystemRoles } from 'librechat-data-provider';
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
import type { LocalizeFunction } from '~/common';
import {
  useCreateKnowledgeCollectionMutation,
  isKnowledgeNameTooLong,
  isKnowledgeDescriptionTooLong,
  KNOWLEDGE_DESCRIPTION_MAX_UNITS,
  KNOWLEDGE_NAME_MAX_LENGTH,
  KNOWLEDGE_NAME_MAX_UNITS,
} from '~/data-provider';
import { useAuthContext, useLocalize } from '~/hooks';
import { getKnowledgeErrorMessage } from './errors';

/**
 * The scopes the client can apply, narrowest first. The only source of a scope
 * the client produces — both editors read it from here and nothing else.
 *
 * `'project'` is absent because the server has no project concept: there are no
 * project members, and `canAccessCollection` grants a collection to its owner or
 * to everyone when the scope is `global`. A collection created with `'project'`
 * was stored and read back exactly like a `private` one, so the choice was a
 * control that silently did nothing — the user picked "Project", the request
 * succeeded, and nothing about the collection changed. Offering two scopes with
 * identical behaviour is the same bug wearing a different label.
 */
export const KNOWLEDGE_SCOPE_CHOICES: TKnowledgeCollectionScope[] = ['private', 'global'];

/**
 * The scope vocabulary, defined once and shared by the list cards, the workspace
 * header and both editors. It lives beside the editors because a scope is a field
 * value: they are the only place it can be changed, so this is the module that
 * knows what the scopes are called.
 *
 * `'project'` has no branch, and that is deliberate rather than an oversight: a
 * collection stored with it reads back as the fallback because the client cannot
 * be offered a scope it does not understand. A chip that misreports the stored
 * value is the lesser evil next to the alternative, which is a "Project" choice
 * that quietly produces a private collection.
 */
export function getKnowledgeScopeLabel(
  scope: TKnowledgeCollectionScope,
  localize: LocalizeFunction,
): string {
  return scope === 'global'
    ? localize('com_ui_knowledge_scope_global')
    : localize('com_ui_knowledge_scope_private');
}

/**
 * The scope choices this user may actually apply.
 *
 * `global` is admin-only: the server's `canUseScope` requires the ADMIN role to
 * put a collection into it, so offering it to anyone else is a control whose only
 * possible outcome is a 403. The role comes from the auth context rather than
 * from a second fetch, and an unresolved user reads as non-admin, which withholds
 * the one scope that cannot be applied rather than offering it.
 */
export function useKnowledgeScopeOptions(): { value: TKnowledgeCollectionScope; label: string }[] {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const isAdmin = user?.role === SystemRoles.ADMIN;

  return useMemo(
    () =>
      KNOWLEDGE_SCOPE_CHOICES.filter((value) => isAdmin || value !== 'global').map((value) => ({
        value,
        label: getKnowledgeScopeLabel(value, localize),
      })),
    [isAdmin, localize],
  );
}

type KnowledgeCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (collection: TKnowledgeCollection) => void;
};

export default function KnowledgeCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: KnowledgeCreateDialogProps) {
  const localize = useLocalize();
  const formId = useId();
  const scopeLabelId = `${formId}-scope-label`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<TKnowledgeCollectionScope>('private');
  const createCollection = useCreateKnowledgeCollectionMutation();
  const { showToast } = useToastContext();
  const scopeOptions = useKnowledgeScopeOptions();
  /** `isLoading` only reaches the button on the next render, so a second click
   *  inside that window created the collection twice. This latch is synchronous. */
  const isSubmitting = useRef(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const frameId = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frameId);
  }, [open]);

  /** The cap is on code points, which `maxLength` cannot express, so the submit
   *  is gated here instead. See `isKnowledgeNameTooLong`. */
  const isNameTooLong = isKnowledgeNameTooLong(name);
  const isDescriptionTooLong = isKnowledgeDescriptionTooLong(description);
  const nameErrorId = `${formId}-name-error`;

  const resetForm = () => {
    setName('');
    setDescription('');
    setScope('private');
    isSubmitting.current = false;
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen && !createCollection.isLoading) {
      resetForm();
    }
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || isNameTooLong || isDescriptionTooLong || isSubmitting.current) {
      return;
    }

    isSubmitting.current = true;
    try {
      const trimmedDescription = description.trim();
      const collection = await createCollection.mutateAsync({
        name: trimmedName,
        scope,
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
      });
      showToast({
        message: localize('com_ui_knowledge_collection_created'),
        status: 'success',
      });
      resetForm();
      onOpenChange(false);
      onCreated?.(collection);
    } catch (createError) {
      /** Released before the toast so the same name can be submitted again, which
       *  is the whole point of keeping the draft. */
      isSubmitting.current = false;
      /** The draft is deliberately left in place: the dialog stays open so the
       *  same name can be submitted again once the failure is understood. */
      showToast({
        message: getKnowledgeErrorMessage(createError, localize),
        status: 'error',
      });
    }
  };

  return (
    <OGDialog open={open} onOpenChange={handleOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_knowledge_create_collection')}
        description={localize('com_ui_knowledge_create_dialog_description')}
        showCloseButton={false}
        className="w-11/12 max-w-md"
        main={
          <form id={formId} onSubmit={handleCreate} className="flex flex-col gap-4">
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
            {/* One choice is not a choice. A non-admin is offered `private` alone, so the
                control is withheld rather than shown as a single unchangeable segment. */}
            {scopeOptions.length > 1 ? (
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
              !name.trim() || isNameTooLong || isDescriptionTooLong || createCollection.isLoading
            }
            aria-label={localize('com_ui_knowledge_create')}
            className="active:scale-[0.96]"
          >
            {createCollection.isLoading ? (
              <Spinner className="size-4" />
            ) : (
              localize('com_ui_knowledge_create')
            )}
          </Button>
        }
      />
    </OGDialog>
  );
}
