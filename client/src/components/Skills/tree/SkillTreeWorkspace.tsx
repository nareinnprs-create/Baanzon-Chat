import { useMemo, useState, useEffect, useCallback } from 'react';
import { useAtom } from 'jotai';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button, Spinner, useToastContext } from '@librechat/client';
import type { TSkillFile, TSkillNode } from 'librechat-data-provider';
import {
  useGetSkillQuery,
  useGetSkillTreeQuery,
  useCreateSkillNodeMutation,
  useUpdateSkillNodeMutation,
  useDeleteSkillNodeMutation,
  useUploadSkillFileMutation,
} from '~/data-provider';
import { DeleteNodeDialog, NewNodeDialog, RenameNodeDialog, UploadNodeDialog } from './NodeDialogs';
import { buildNodeTree, collectFolderPaths, isSelfOrDescendantPath } from './tree';
import { skillTreeExpandedFoldersAtom, skillTreeSelectedNodeAtom } from './atoms';
import { useLocalize, useSkillPermissions } from '~/hooks';
import SkillFileEditor from './SkillFileEditor';
import { SKILL_TREE_LABELS } from './labels';
import SkillTreeView from './SkillTreeView';
import TreeToolbar from './TreeToolbar';
import { cn } from '~/utils';

const TEXT_LIKE_MIME = new Set([
  'application/json',
  'application/javascript',
  'application/xml',
  'application/x-sh',
  'application/x-yaml',
  'application/yaml',
  'application/toml',
]);

type DialogState =
  | { type: 'new' }
  | { type: 'upload' }
  | { type: 'rename'; node: TSkillNode }
  | { type: 'delete'; node: TSkillNode }
  | null;

function messageOf(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { error?: string; message?: string } } } | undefined)
    ?.response?.data;
  return data?.message ?? data?.error ?? fallback;
}

function isTextLike(file: File): boolean {
  return file.type === '' || file.type.startsWith('text/') || TEXT_LIKE_MIME.has(file.type);
}

interface SkillTreeWorkspaceProps {
  skillId: string;
}

/**
 * Container for the phase-2 skill tree: it owns the tree query, selection and
 * expansion state, and every node mutation, then hands plain data and
 * callbacks to the presentational tree, toolbar, editor and dialogs. Loading,
 * empty, error/retry, success and failure (including a failed dialog that stays
 * open to retry) are all surfaced here.
 */
export default function SkillTreeWorkspace({ skillId }: SkillTreeWorkspaceProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const queryClient = useQueryClient();

  const skillQuery = useGetSkillQuery(skillId);
  const permissions = useSkillPermissions(skillQuery.data);
  const canEdit = permissions.canEdit;

  const treeQuery = useGetSkillTreeQuery(skillId);
  const nodes = useMemo(() => treeQuery.data?.nodes ?? [], [treeQuery.data]);
  const branches = useMemo(() => buildNodeTree(nodes), [nodes]);
  const folderPaths = useMemo(() => collectFolderPaths(nodes), [nodes]);

  const [selectedId, setSelectedId] = useAtom(skillTreeSelectedNodeAtom);
  const [expandedIds, setExpandedIds] = useAtom(skillTreeExpandedFoldersAtom);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedId(null);
    setExpandedIds(new Set());
    setDialog(null);
    setDialogError(null);
  }, [skillId, setSelectedId, setExpandedIds]);

  useEffect(() => {
    if (!treeQuery.data) {
      return;
    }
    setExpandedIds((prev) =>
      prev.size > 0 ? prev : new Set(collectFolderPaths(treeQuery.data.nodes)),
    );
  }, [treeQuery.data, setExpandedIds]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node._id === selectedId && node.type === 'file') ?? null,
    [nodes, selectedId],
  );

  const closeDialog = useCallback(() => {
    setDialog(null);
    setDialogError(null);
  }, []);

  /**
   * Node mutations change the derived tree plus the flat file list and the
   * skill's own metadata (file count). The tree hooks invalidate only
   * `skillTree`, and the files-route upload invalidates only the latter two, so
   * refresh all three regardless of which route ran.
   */
  const invalidateSkill = useCallback(() => {
    queryClient.invalidateQueries([QueryKeys.skillTree, skillId]);
    queryClient.invalidateQueries([QueryKeys.skillFiles, skillId]);
    queryClient.invalidateQueries([QueryKeys.skill, skillId]);
  }, [queryClient, skillId]);

  const openDialog = useCallback((next: DialogState) => {
    setDialogError(null);
    setDialog(next);
  }, []);

  const handleToggle = useCallback(
    (nodeId: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
    },
    [setExpandedIds],
  );

  const handleActivate = useCallback(
    (node: TSkillNode) => {
      if (node.type === 'file') {
        setSelectedId(node._id);
      }
    },
    [setSelectedId],
  );

  /** Reveal a freshly created node: select it and open its parent folder. */
  const revealNode = useCallback(
    (nodeId: string) => {
      setSelectedId(nodeId);
      const parentId = nodeId.includes('/') ? nodeId.slice(0, nodeId.lastIndexOf('/')) : null;
      if (parentId) {
        setExpandedIds((prev) => new Set(prev).add(parentId));
      }
    },
    [setSelectedId, setExpandedIds],
  );

  const createNode = useCreateSkillNodeMutation(skillId, {
    onSuccess: (node) => {
      showToast({ status: 'success', message: SKILL_TREE_LABELS.created });
      invalidateSkill();
      revealNode(node._id);
      closeDialog();
    },
    onError: (error) => setDialogError(messageOf(error, SKILL_TREE_LABELS.createFailed)),
  });

  const uploadFile = useUploadSkillFileMutation({
    onSuccess: (file: TSkillFile) => {
      showToast({ status: 'success', message: SKILL_TREE_LABELS.uploaded });
      invalidateSkill();
      revealNode(file.relativePath);
      closeDialog();
    },
    onError: (error) => setDialogError(messageOf(error, SKILL_TREE_LABELS.createFailed)),
  });

  const updateNode = useUpdateSkillNodeMutation(skillId, {
    onSuccess: (node, variables) => {
      const oldId = variables.nodeId;
      const newId = node._id;
      if (oldId !== newId) {
        setSelectedId((prev) =>
          prev && isSelfOrDescendantPath(prev, oldId) ? newId + prev.slice(oldId.length) : prev,
        );
        setExpandedIds((prev) => {
          const next = new Set<string>();
          prev.forEach((id) => {
            next.add(isSelfOrDescendantPath(id, oldId) ? newId + id.slice(oldId.length) : id);
          });
          return next;
        });
      }
      showToast({ status: 'success', message: SKILL_TREE_LABELS.renamed });
      invalidateSkill();
      closeDialog();
    },
    onError: (error) => setDialogError(messageOf(error, SKILL_TREE_LABELS.renameFailed)),
  });

  const deleteNode = useDeleteSkillNodeMutation(skillId, {
    onSuccess: (_result, variables) => {
      const removedId = variables.nodeId;
      setSelectedId((prev) => (prev && isSelfOrDescendantPath(prev, removedId) ? null : prev));
      setExpandedIds((prev) => {
        const next = new Set<string>();
        prev.forEach((id) => {
          if (!isSelfOrDescendantPath(id, removedId)) {
            next.add(id);
          }
        });
        return next;
      });
      showToast({ status: 'success', message: SKILL_TREE_LABELS.deleted });
      invalidateSkill();
      closeDialog();
    },
    onError: (error) => setDialogError(messageOf(error, SKILL_TREE_LABELS.deleteFailed)),
  });

  const handleCreateFile = useCallback(
    ({ parentId, name }: { parentId: string | null; name: string }) => {
      setDialogError(null);
      createNode.mutate({
        skillId,
        data: { type: 'file', name, parentId },
      });
    },
    [createNode, skillId],
  );

  const handleUpload = useCallback(
    ({ parentId, file }: { parentId: string | null; file: File }) => {
      setDialogError(null);
      if (isTextLike(file)) {
        const formData = new FormData();
        formData.append('type', 'file');
        formData.append('name', file.name);
        if (parentId) {
          formData.append('parentId', parentId);
        }
        formData.append('file', file, file.name);
        createNode.mutate({ skillId, data: formData });
        return;
      }
      const relativePath = parentId ? `${parentId}/${file.name}` : file.name;
      const formData = new FormData();
      formData.append('file', file, file.name);
      formData.append('relativePath', relativePath);
      uploadFile.mutate({ skillId, formData });
    },
    [createNode, uploadFile, skillId],
  );

  const handleRename = useCallback(
    ({ parentId, name }: { parentId: string | null; name: string }) => {
      if (dialog?.type !== 'rename') {
        return;
      }
      setDialogError(null);
      updateNode.mutate({
        skillId,
        nodeId: dialog.node._id,
        data: { name, parentId },
      });
    },
    [dialog, updateNode, skillId],
  );

  const handleDelete = useCallback(() => {
    if (dialog?.type !== 'delete') {
      return;
    }
    setDialogError(null);
    deleteNode.mutate({ skillId, nodeId: dialog.node._id });
  }, [dialog, deleteNode, skillId]);

  const defaultParentId = useMemo(() => {
    if (selectedId && selectedId.includes('/')) {
      return selectedId.slice(0, selectedId.lastIndexOf('/'));
    }
    return null;
  }, [selectedId]);

  let treeBody: React.ReactNode;
  if (treeQuery.isLoading) {
    treeBody = (
      <div className="flex h-24 items-center justify-center">
        <Spinner className="text-text-tertiary" aria-label={localize('com_ui_loading')} />
      </div>
    );
  } else if (treeQuery.isError) {
    treeBody = (
      <div className="flex flex-col items-center gap-2 p-4 text-center text-xs text-text-secondary">
        <AlertTriangle className="size-5 text-text-destructive" aria-hidden="true" />
        <p>{SKILL_TREE_LABELS.treeLoadError}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-xs"
          onClick={() => treeQuery.refetch()}
          disabled={treeQuery.isFetching}
        >
          <RotateCcw
            className={cn('size-3.5', treeQuery.isFetching && 'animate-spin')}
            aria-hidden="true"
          />
          {localize('com_ui_retry')}
        </Button>
      </div>
    );
  } else if (nodes.length === 0) {
    treeBody = <p className="p-4 text-xs text-text-secondary">{SKILL_TREE_LABELS.noFiles}</p>;
  } else {
    treeBody = (
      <SkillTreeView
        branches={branches}
        selectedId={selectedId}
        expandedIds={expandedIds}
        canEdit={canEdit}
        onActivate={handleActivate}
        onToggle={handleToggle}
        onRename={(node) => openDialog({ type: 'rename', node })}
        onDelete={(node) => openDialog({ type: 'delete', node })}
      />
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="flex w-64 shrink-0 flex-col border-r border-border-light bg-surface-secondary">
        <TreeToolbar
          canEdit={canEdit}
          isRefreshing={treeQuery.isFetching}
          onNewFile={() => openDialog({ type: 'new' })}
          onUpload={() => openDialog({ type: 'upload' })}
          onRefresh={() => treeQuery.refetch()}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">{treeBody}</div>
      </div>

      <div className="min-w-0 flex-1">
        {selectedNode ? (
          <SkillFileEditor
            key={selectedNode._id}
            skillId={skillId}
            nodeId={selectedNode._id}
            fileName={selectedNode.name}
            canEdit={canEdit}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-presentation p-8 text-center text-sm text-text-secondary">
            {SKILL_TREE_LABELS.selectHint}
          </div>
        )}
      </div>

      {dialog?.type === 'new' && (
        <NewNodeDialog
          onOpenChange={(open) => (open ? undefined : closeDialog())}
          folderPaths={folderPaths}
          defaultParentId={defaultParentId}
          onSubmit={handleCreateFile}
          isSubmitting={createNode.isLoading}
          error={dialogError}
        />
      )}
      {dialog?.type === 'upload' && (
        <UploadNodeDialog
          onOpenChange={(open) => (open ? undefined : closeDialog())}
          folderPaths={folderPaths}
          defaultParentId={defaultParentId}
          onSubmit={handleUpload}
          isSubmitting={createNode.isLoading || uploadFile.isLoading}
          error={dialogError}
        />
      )}
      {dialog?.type === 'rename' && (
        <RenameNodeDialog
          node={dialog.node}
          onOpenChange={(open) => (open ? undefined : closeDialog())}
          folderPaths={folderPaths}
          onSubmit={handleRename}
          isSubmitting={updateNode.isLoading}
          error={dialogError}
        />
      )}
      {dialog?.type === 'delete' && (
        <DeleteNodeDialog
          node={dialog.node}
          onOpenChange={(open) => (open ? undefined : closeDialog())}
          onConfirm={handleDelete}
          isSubmitting={deleteNode.isLoading}
          error={dialogError}
        />
      )}
    </div>
  );
}
