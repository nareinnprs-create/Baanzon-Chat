import { useState, useRef, useCallback } from 'react';
import { Upload, AlertTriangle } from 'lucide-react';
import { Button, Input, Label, OGDialog, OGDialogContent, Spinner } from '@librechat/client';
import type { TSkillNode } from 'librechat-data-provider';
import { splitNodePath, isValidNodeName, isSelfOrDescendantPath } from './tree';
import { SKILL_TREE_LABELS, formatSkillTreeLabel } from './labels';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface CreateInput {
  parentId: string | null;
  name: string;
}

interface UploadInput {
  parentId: string | null;
  file: File;
}

interface RenameInput {
  parentId: string | null;
  name: string;
}

/**
 * Controlled dialogs for the skill-tree mutations. They own only form state and
 * validation; the workspace owns the data-provider hooks and passes results
 * down. None of them close on a failed submit — the inline error stays and the
 * primary button doubles as retry.
 */

function DialogFooter({
  submitLabel,
  isSubmitting,
  disabled,
  onSubmit,
  onClose,
}: {
  submitLabel: string;
  isSubmitting: boolean;
  disabled?: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const localize = useLocalize();
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button
        type="button"
        variant="outline"
        onClick={onClose}
        disabled={isSubmitting}
        className="w-full sm:w-auto"
      >
        {localize('com_ui_cancel')}
      </Button>
      <Button
        type="button"
        onClick={onSubmit}
        disabled={isSubmitting || disabled}
        className={cn('w-full sm:w-auto', (isSubmitting || disabled) && 'opacity-50')}
      >
        {isSubmitting ? <Spinner className="size-4" /> : null}
        {submitLabel}
      </Button>
    </div>
  );
}

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <div
      role="alert"
      className="bg-surface-destructive-subtle flex items-start gap-2 rounded-md border border-border-destructive p-2 text-xs text-text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function FolderField({
  id,
  value,
  onChange,
  folderPaths,
  excluded,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  folderPaths: string[];
  excluded?: Set<string>;
}) {
  const localize = useLocalize();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs font-medium text-text-secondary">
        {SKILL_TREE_LABELS.parentFolder}
      </Label>
      <Input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={SKILL_TREE_LABELS.root}
        list={`${id}-options`}
        className="w-full text-sm"
        autoComplete="off"
      />
      <datalist id={`${id}-options`}>
        <option value="" label={SKILL_TREE_LABELS.root} />
        {folderPaths
          .filter((path) => !excluded?.has(path))
          .map((path) => (
            <option key={path} value={path} />
          ))}
      </datalist>
      <p className="text-[11px] text-text-secondary">
        {localize('com_ui_path')}: {value.trim() === '' ? SKILL_TREE_LABELS.root : value.trim()}
      </p>
    </div>
  );
}

export function NewNodeDialog({
  onOpenChange,
  folderPaths,
  defaultParentId,
  onSubmit,
  isSubmitting,
  error,
}: {
  onOpenChange: (open: boolean) => void;
  folderPaths: string[];
  defaultParentId: string | null;
  onSubmit: (input: CreateInput) => void;
  isSubmitting: boolean;
  error: string | null;
}) {
  const localize = useLocalize();
  const [parent, setParent] = useState(defaultParentId ?? '');
  const [name, setName] = useState('');
  const nameValid = isValidNodeName(name);

  const handleSubmit = () => {
    if (!nameValid || isSubmitting) {
      return;
    }
    onSubmit({
      parentId: parent.trim() === '' ? null : parent.trim(),
      name: name.trim(),
    });
  };

  return (
    <OGDialog open onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-md" showCloseButton={!isSubmitting}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-bold text-text-primary">
              {localize('com_ui_skill_new_file')}
            </h2>
            <p className="text-xs text-text-secondary">{SKILL_TREE_LABELS.newFileSubtitle}</p>
          </div>
          <FolderField
            id="new-node-parent"
            value={parent}
            onChange={setParent}
            folderPaths={folderPaths}
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-node-name" className="text-xs font-medium text-text-secondary">
              {localize('com_ui_name')}
            </Label>
            <Input
              id="new-node-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleSubmit();
                }
              }}
              autoComplete="off"
              className="w-full text-sm"
              aria-invalid={name.length > 0 && !nameValid ? 'true' : 'false'}
            />
            {name.length > 0 && !nameValid && (
              <p className="text-[11px] text-text-destructive" role="alert">
                {SKILL_TREE_LABELS.invalidPath}
              </p>
            )}
          </div>
          <ErrorBanner message={error} />
          <DialogFooter
            submitLabel={localize('com_ui_create')}
            isSubmitting={isSubmitting}
            disabled={!nameValid}
            onSubmit={handleSubmit}
            onClose={() => onOpenChange(false)}
          />
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}

export function UploadNodeDialog({
  onOpenChange,
  folderPaths,
  defaultParentId,
  onSubmit,
  isSubmitting,
  error,
}: {
  onOpenChange: (open: boolean) => void;
  folderPaths: string[];
  defaultParentId: string | null;
  onSubmit: (input: UploadInput) => void;
  isSubmitting: boolean;
  error: string | null;
}) {
  const localize = useLocalize();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parent, setParent] = useState(defaultParentId ?? '');
  const [file, setFile] = useState<File | null>(null);

  const handleSubmit = () => {
    if (!file || isSubmitting) {
      return;
    }
    onSubmit({
      parentId: parent.trim() === '' ? null : parent.trim(),
      file,
    });
  };

  const handleFileInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected) {
      setFile(selected);
    }
  }, []);

  return (
    <OGDialog open onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-md" showCloseButton={!isSubmitting}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-bold text-text-primary">
              {localize('com_ui_skill_upload_file')}
            </h2>
            <p className="text-xs text-text-secondary">{SKILL_TREE_LABELS.uploadSubtitle}</p>
          </div>
          <FolderField
            id="upload-node-parent"
            value={parent}
            onChange={setParent}
            folderPaths={folderPaths}
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor="upload-node-file" className="text-xs font-medium text-text-secondary">
              {localize('com_ui_file')}
            </Label>
            <button
              id="upload-node-file"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSubmitting}
              className="flex h-[88px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border-medium text-sm text-text-secondary transition-colors hover:bg-surface-hover disabled:cursor-wait disabled:opacity-50"
            >
              {isSubmitting ? (
                <Spinner className="size-5" />
              ) : (
                <Upload className="size-5" aria-hidden="true" />
              )}
              <span className="truncate">{file ? file.name : localize('com_ui_select_file')}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileInput}
              disabled={isSubmitting}
            />
          </div>
          <ErrorBanner message={error} />
          <DialogFooter
            submitLabel={localize('com_ui_create')}
            isSubmitting={isSubmitting}
            disabled={!file}
            onSubmit={handleSubmit}
            onClose={() => onOpenChange(false)}
          />
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}

export function RenameNodeDialog({
  node,
  onOpenChange,
  folderPaths,
  onSubmit,
  isSubmitting,
  error,
}: {
  node: TSkillNode;
  onOpenChange: (open: boolean) => void;
  folderPaths: string[];
  onSubmit: (input: RenameInput) => void;
  isSubmitting: boolean;
  error: string | null;
}) {
  const localize = useLocalize();
  const initial = splitNodePath(node._id);
  const [parent, setParent] = useState(initial.parentId ?? '');
  const [name, setName] = useState(initial.name);
  const nameValid = isValidNodeName(name);

  const excluded = new Set<string>();
  if (node.type === 'folder') {
    folderPaths.forEach((path) => {
      if (isSelfOrDescendantPath(path, node._id)) {
        excluded.add(path);
      }
    });
  }
  const parentNormalized = parent.trim();
  const movesIntoDescendant =
    node.type === 'folder' &&
    parentNormalized !== '' &&
    isSelfOrDescendantPath(parentNormalized, node._id);

  const handleSubmit = () => {
    if (!nameValid || movesIntoDescendant || isSubmitting) {
      return;
    }
    onSubmit({
      parentId: parentNormalized === '' ? null : parentNormalized,
      name: name.trim(),
    });
  };

  return (
    <OGDialog open onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-md" showCloseButton={!isSubmitting}>
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-text-primary">{SKILL_TREE_LABELS.moveTitle}</h2>
          <FolderField
            id="rename-node-parent"
            value={parent}
            onChange={setParent}
            folderPaths={folderPaths}
            excluded={excluded}
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor="rename-node-name" className="text-xs font-medium text-text-secondary">
              {localize('com_ui_name')}
            </Label>
            <Input
              id="rename-node-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleSubmit();
                }
              }}
              autoComplete="off"
              className="w-full text-sm"
              aria-invalid={!nameValid || movesIntoDescendant ? 'true' : 'false'}
            />
            {(!nameValid || movesIntoDescendant) && (
              <p className="text-[11px] text-text-destructive" role="alert">
                {SKILL_TREE_LABELS.invalidPath}
              </p>
            )}
          </div>
          <ErrorBanner message={error} />
          <DialogFooter
            submitLabel={localize('com_ui_save')}
            isSubmitting={isSubmitting}
            disabled={!nameValid || movesIntoDescendant}
            onSubmit={handleSubmit}
            onClose={() => onOpenChange(false)}
          />
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}

export function DeleteNodeDialog({
  node,
  onOpenChange,
  onConfirm,
  isSubmitting,
  error,
}: {
  node: TSkillNode;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isSubmitting: boolean;
  error: string | null;
}) {
  const localize = useLocalize();
  const isFolder = node.type === 'folder';

  return (
    <OGDialog open onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-md" showCloseButton={!isSubmitting}>
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-text-primary">
            {isFolder ? localize('com_ui_delete') : SKILL_TREE_LABELS.deleteTitle}
          </h2>
          <p className="text-sm text-text-primary">
            {formatSkillTreeLabel(isFolder ? 'deleteFolderConfirm' : 'deleteConfirm', {
              '0': node.name,
            })}
          </p>
          <ErrorBanner message={error} />
          <DialogFooter
            submitLabel={localize('com_ui_delete')}
            isSubmitting={isSubmitting}
            onSubmit={onConfirm}
            onClose={() => onOpenChange(false)}
          />
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
