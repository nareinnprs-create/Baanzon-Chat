import { useRef, useState, useCallback } from 'react';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Spinner, Textarea, useToastContext } from '@librechat/client';
import { Save, FileText, Circle, AlertTriangle, RotateCcw } from 'lucide-react';
import { useGetSkillNodeContentQuery, useUpdateSkillNodeContentMutation } from '~/data-provider';
import SkillFilePreview from './SkillFilePreview';
import { SKILL_TREE_LABELS } from './labels';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const BODY_NODE_ID = 'SKILL.md';

interface SkillFileEditorProps {
  skillId: string;
  nodeId: string;
  fileName: string;
  canEdit: boolean;
}

/** HTTP status of an axios rejection, without asserting the whole error shape. */
function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | undefined)?.response?.status;
}

function messageOf(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { error?: string; message?: string } } } | undefined)
    ?.response?.data;
  return data?.message ?? data?.error ?? fallback;
}

/**
 * Node content panel for the skill tree. Text nodes are editable in place;
 * `SKILL.md` and read-only callers render as source, and binary or oversized
 * files fall back to a download preview. The content route is a real request,
 * so every query/mutation outcome (loading, success, failure, retry) is a
 * visible state here.
 */
export default function SkillFileEditor({
  skillId,
  nodeId,
  fileName,
  canEdit,
}: SkillFileEditorProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { showToast } = useToastContext();
  const isBody = nodeId === BODY_NODE_ID;
  const editable = canEdit && !isBody;

  const contentQuery = useGetSkillNodeContentQuery(skillId, nodeId, { retry: false });
  const { data, isLoading, isError, error, refetch, isFetching } = contentQuery;

  const updateContent = useUpdateSkillNodeContentMutation(skillId, {
    onSuccess: (_node, variables) => {
      queryClient.invalidateQueries([QueryKeys.skillTree, skillId]);
      queryClient.invalidateQueries([QueryKeys.skillFiles, skillId]);
      queryClient.invalidateQueries([QueryKeys.skill, skillId]);
      if (variables.nodeId === nodeId) {
        showToast({ status: 'success', message: localize('com_ui_saved') });
      }
    },
    onError: (mutationError) => {
      showToast({
        status: 'error',
        message: messageOf(mutationError, SKILL_TREE_LABELS.saveFailed),
      });
    },
  });

  const [localContent, setLocalContent] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevNodeRef = useRef(nodeId);
  if (prevNodeRef.current !== nodeId) {
    prevNodeRef.current = nodeId;
    setLocalContent(null);
  }

  const serverContent = data?.content ?? '';
  const displayContent = localContent ?? serverContent;
  const isDirty = localContent !== null && localContent !== serverContent;
  const saveError =
    updateContent.isError && updateContent.variables?.nodeId === nodeId
      ? messageOf(updateContent.error, SKILL_TREE_LABELS.saveFailed)
      : null;

  const handleChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalContent(event.target.value);
  }, []);

  const handleSave = useCallback(() => {
    if (!editable || !isDirty || localContent === null || updateContent.isLoading) {
      return;
    }
    const savedContent = localContent;
    queryClient.setQueryData([QueryKeys.skillNodeContent, skillId, nodeId], {
      content: savedContent,
      mimeType: data?.mimeType ?? 'text/plain',
    });
    updateContent.mutate({ skillId, nodeId, content: savedContent });
  }, [
    data?.mimeType,
    editable,
    isDirty,
    localContent,
    nodeId,
    queryClient,
    skillId,
    updateContent,
  ]);

  const handleCancel = useCallback(() => {
    if (updateContent.isLoading) {
      return;
    }
    setLocalContent(null);
  }, [updateContent.isLoading]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        handleSave();
      }
    },
    [handleSave],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-presentation">
        <Spinner className="text-text-tertiary" aria-label={localize('com_ui_loading')} />
      </div>
    );
  }

  if (isError) {
    const status = statusOf(error);
    if (status === 415) {
      return (
        <SkillFilePreview skillId={skillId} nodeId={nodeId} fileName={fileName} reason="binary" />
      );
    }
    if (status === 413) {
      return (
        <SkillFilePreview
          skillId={skillId}
          nodeId={nodeId}
          fileName={fileName}
          reason="too-large"
        />
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-text-secondary">
        <AlertTriangle className="size-8 text-text-destructive" aria-hidden="true" />
        <p className="text-sm">{localize('com_ui_skill_file_load_error')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label={localize('com_ui_retry')}
        >
          <RotateCcw className={cn('size-3.5', isFetching && 'animate-spin')} aria-hidden="true" />
          {localize('com_ui_retry')}
        </Button>
      </div>
    );
  }

  const lineCount = displayContent.split('\n').length;
  let readOnlyNote: string | null = null;
  if (isBody) {
    readOnlyNote = SKILL_TREE_LABELS.skillMdReadonly;
  } else if (!canEdit) {
    readOnlyNote = localize('com_ui_skill_no_edit_permission');
  }

  return (
    <div className="flex h-full flex-col bg-presentation" onKeyDown={handleKeyDown}>
      <div className="flex items-center gap-2 border-b border-border-light px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FileText className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
          <span className="truncate text-sm font-medium text-text-primary" title={fileName}>
            {fileName}
          </span>
          <Circle
            className={cn(
              'size-2 shrink-0 transition-[opacity,color] duration-200',
              isDirty ? 'fill-current text-status-warning opacity-100' : 'opacity-0',
            )}
            aria-hidden="true"
          />
        </div>
        {editable && (
          <div className="flex shrink-0 items-center gap-2">
            {isDirty && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={handleCancel}
                disabled={updateContent.isLoading}
              >
                {localize('com_ui_cancel')}
              </Button>
            )}
            <Button
              type="button"
              variant={isDirty ? 'submit' : 'outline'}
              size="sm"
              disabled={!isDirty || updateContent.isLoading}
              onClick={handleSave}
              aria-label={localize('com_ui_save')}
              className="h-7 gap-1.5 px-2.5 text-xs"
            >
              {updateContent.isLoading ? (
                <Spinner className="size-3" />
              ) : (
                <Save className="size-3" aria-hidden="true" />
              )}
              {updateContent.isLoading ? localize('com_ui_saving') : localize('com_ui_save')}
            </Button>
          </div>
        )}
      </div>

      {readOnlyNote && (
        <p className="border-b border-border-light px-4 py-1.5 text-xs text-text-secondary">
          {readOnlyNote}
        </p>
      )}

      {saveError && (
        <p
          className="border-b border-border-light px-4 py-1.5 text-xs text-text-destructive"
          role="alert"
        >
          {saveError}
        </p>
      )}

      <div className="relative flex-1 overflow-hidden">
        {editable ? (
          <Textarea
            ref={textareaRef}
            value={displayContent}
            onChange={handleChange}
            spellCheck={false}
            className={cn(
              'size-full resize-none rounded-none border-0 bg-transparent px-4 py-3 font-mono text-[13px] leading-6 text-text-primary outline-none',
              'focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring-primary',
            )}
            aria-label={`${localize('com_ui_edit')} ${fileName}`}
          />
        ) : (
          <pre className="size-full overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-[13px] leading-6 text-text-primary">
            {displayContent}
          </pre>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border-light px-4 py-1">
        <span className="text-[11px] text-text-secondary">
          {lineCount === 1
            ? localize('com_ui_line_count', { 0: String(lineCount) })
            : localize('com_ui_lines_count', { 0: String(lineCount) })}
        </span>
        <span className="text-[11px] text-text-secondary">
          {isDirty ? localize('com_ui_file_modified') : localize('com_ui_saved')}
        </span>
      </div>
    </div>
  );
}
