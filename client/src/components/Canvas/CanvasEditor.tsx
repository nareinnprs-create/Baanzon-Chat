import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button, Input, Label, Textarea } from '@librechat/client';
import { ArrowDown, ArrowUp, Sparkles, Trash2 } from 'lucide-react';
import type { ChangeEvent, SyntheticEvent } from 'react';
import type { CanvasBlock, CanvasDocument, CanvasEditOperation, CanvasSelection } from './types';
import type { MoveBlockDirection } from './state';
import type { EditSelectionFn } from './api';
import { CANVAS_LABELS as L } from './labels';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export type CanvasEditorProps = {
  document: CanvasDocument;
  /** The current selection, lifted so the workspace and comments can read it. */
  selection: CanvasSelection | null;
  /** Force-disable the surface, e.g. while the document is being saved. */
  busy?: boolean;
  className?: string;
  onTitleChange: (title: string) => void;
  onBlockTextChange: (blockId: string, text: string) => void;
  onSelectionChange: (selection: CanvasSelection | null) => void;
  /** Move a block one position; the per-block controls render only when set. */
  onMoveBlock?: (blockId: string, direction: MoveBlockDirection) => void;
  /** Remove a block; the remove control renders only when set. */
  onRemoveBlock?: (blockId: string) => void;
  /**
   * The injected AI edit backend. The editor calls it with the current
   * selection and the instruction, then hands the returned operations back
   * through `onOperations`; it never knows what produced them.
   */
  editSelection: EditSelectionFn;
  onOperations: (operations: CanvasEditOperation[]) => void;
};

function toErrorMessage(caught: unknown, fallback: string): string {
  if (caught instanceof Error && caught.message) {
    return caught.message;
  }
  if (typeof caught === 'string' && caught) {
    return caught;
  }
  return fallback;
}

/**
 * The editable text surface: one textarea per block, selection tracking per
 * block, per-block move/remove controls, and an inline "AI edit" affordance
 * that appears beside the block the user highlighted. The AI call is injected
 * as `editSelection` and the structural callbacks are supplied by the
 * workspace, so this component carries no backend or store coupling.
 */
export default function CanvasEditor({
  document,
  selection,
  busy = false,
  className,
  onTitleChange,
  onBlockTextChange,
  onSelectionChange,
  onMoveBlock,
  onRemoveBlock,
  editSelection,
  onOperations,
}: CanvasEditorProps) {
  const localize = useLocalize();
  const baseId = useId();
  const [instruction, setInstruction] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  const activeSelection = selection != null && selection.text.trim().length > 0 ? selection : null;

  const handleSelect = useCallback(
    (block: CanvasBlock) => (event: SyntheticEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      const start = target.selectionStart ?? 0;
      const end = target.selectionEnd ?? 0;
      if (start === end) {
        onSelectionChange(null);
        return;
      }
      onSelectionChange({
        blockId: block.id,
        start,
        end,
        text: block.text.slice(start, end),
      });
    },
    [onSelectionChange],
  );

  const runEdit = useCallback(async () => {
    if (!activeSelection || instruction.trim().length === 0 || pending) {
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPending(true);
    setError(null);
    setStatus(localize(L.aiEditBusy));
    try {
      const operations = await editSelection(activeSelection, instruction, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      onOperations(operations);
      setInstruction('');
      setPending(false);
      setStatus(localize(L.aiEditSuccess));
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      setPending(false);
      setError(
        localize(L.aiEditFailure, {
          reason: toErrorMessage(caught, localize(L.failureDescription)),
        }),
      );
      setStatus(null);
    }
  }, [activeSelection, editSelection, instruction, localize, onOperations, pending]);

  const cancelEdit = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setPending(false);
    setInstruction('');
    setError(null);
    setStatus(null);
  }, []);

  const liveMessage =
    status ??
    (activeSelection
      ? localize(L.selectionAnnouncement, { length: activeSelection.text.length })
      : '');

  return (
    <div
      role="group"
      aria-label={localize(L.editorLabel)}
      className={cn('flex h-full min-h-0 flex-col gap-3 overflow-auto p-4', className)}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${baseId}-title`}>{localize(L.titleLabel)}</Label>
        <Input
          id={`${baseId}-title`}
          value={document.title}
          placeholder={localize(L.titlePlaceholder)}
          disabled={busy}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onTitleChange(event.target.value)}
        />
      </div>

      <ol aria-label={localize(L.editorLabel)} className="flex list-none flex-col gap-3 p-0">
        {document.blocks.map((block, index) => {
          const blockSelection = activeSelection?.blockId === block.id ? activeSelection : null;
          return (
            <li key={block.id} className="flex flex-col gap-2">
              <Textarea
                aria-label={localize(L.blockLabel, { index: index + 1 })}
                value={block.text}
                disabled={busy}
                rows={3}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  onBlockTextChange(block.id, event.target.value)
                }
                onSelect={handleSelect(block)}
              />

              {onMoveBlock != null || onRemoveBlock != null ? (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={localize(L.moveBlockUp, { index: index + 1 })}
                    disabled={busy || index === 0 || onMoveBlock == null}
                    onClick={() => onMoveBlock?.(block.id, 'up')}
                  >
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={localize(L.moveBlockDown, { index: index + 1 })}
                    disabled={busy || index === document.blocks.length - 1 || onMoveBlock == null}
                    onClick={() => onMoveBlock?.(block.id, 'down')}
                  >
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={localize(L.removeBlock, { index: index + 1 })}
                    disabled={busy || onRemoveBlock == null}
                    onClick={() => onRemoveBlock?.(block.id)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : null}

              {blockSelection ? (
                <div
                  role="group"
                  aria-label={localize(L.aiEdit)}
                  className="flex flex-col gap-2 rounded-xl border border-border-light bg-surface-secondary p-3"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Sparkles className="size-4 text-text-secondary" aria-hidden="true" />
                    {localize(L.aiEdit)}
                  </div>
                  <Label htmlFor={`${baseId}-instruction-${block.id}`}>
                    {localize(L.aiEditInstructionLabel)}
                  </Label>
                  <Input
                    id={`${baseId}-instruction-${block.id}`}
                    value={instruction}
                    placeholder={localize(L.aiEditInstructionPlaceholder)}
                    disabled={pending || busy}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setInstruction(event.target.value)
                    }
                  />
                  {error ? (
                    <p role="alert" className="text-xs text-text-destructive">
                      {error}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      disabled={pending || busy || instruction.trim().length === 0}
                      onClick={() => {
                        void runEdit();
                      }}
                    >
                      {pending ? localize(L.aiEditBusy) : localize(L.aiEditApply)}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={cancelEdit}>
                      {localize(L.aiEditCancel)}
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <p aria-live="polite" className="sr-only">
        {liveMessage}
      </p>
    </div>
  );
}