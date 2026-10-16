import { useId } from 'react';
import { Button, EmptyState, FieldMessage, Input } from '@librechat/client';
import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from 'lucide-react';
import type { ResearchPlan } from './types';
import { DEEP_RESEARCH_LABELS as L } from './labels';

export type PlanEditorProps = {
  plan: ResearchPlan;
  disabled?: boolean;
  onTopicChange?: (topic: string) => void;
  onAddStep: () => void;
  onRemoveStep: (stepId: string) => void;
  onRenameStep: (stepId: string, title: string) => void;
  onMoveStep: (stepId: string, direction: 'up' | 'down') => void;
};

/** Ids of steps whose title is blank, in order. */
export function findEmptyStepIds(plan: ResearchPlan): string[] {
  return plan.steps.filter((step) => step.title.trim().length === 0).map((step) => step.id);
}

/** A plan is runnable only when it has steps and every step has a title. */
export function isPlanValid(plan: ResearchPlan): boolean {
  return plan.steps.length > 0 && findEmptyStepIds(plan).length === 0;
}

/**
 * Editable list of research steps: add, remove, reorder and rename, with inline
 * validation. Purely presentational — the plan and the edit callbacks are
 * supplied by the view, which owns the reducer.
 */
export default function PlanEditor({
  plan,
  disabled = false,
  onTopicChange,
  onAddStep,
  onRemoveStep,
  onRenameStep,
  onMoveStep,
}: PlanEditorProps) {
  const baseId = useId();
  const emptyStepIds = findEmptyStepIds(plan);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-xl border border-border-light bg-surface-secondary p-4">
        <label htmlFor={`${baseId}-topic`} className="text-sm font-medium text-text-primary">
          {L.planTopicLabel}
        </label>
        <Input
          id={`${baseId}-topic`}
          value={plan.topic}
          disabled={disabled}
          onChange={(event) => onTopicChange?.(event.target.value)}
        />
      </div>

      {plan.steps.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={L.planEmptyTitle}
          description={L.planEmptyDescription}
          action={
            <Button type="button" variant="outline" size="sm" onClick={onAddStep}>
              <Plus className="size-4" aria-hidden="true" />
              {L.addStep}
            </Button>
          }
        />
      ) : (
        <>
          <ol aria-label={L.planHeading} className="flex list-none flex-col gap-2 p-0">
            {plan.steps.map((step, index) => {
              const isEmpty = emptyStepIds.includes(step.id);
              const inputId = `${baseId}-step-${step.id}`;
              const messageId = `${inputId}-message`;
              const isFirst = index === 0;
              const isLast = index === plan.steps.length - 1;
              return (
                <li
                  key={step.id}
                  className="flex flex-col gap-1 rounded-xl border border-border-light bg-surface-primary p-3"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-2 min-w-5 text-center text-xs font-medium tabular-nums text-text-secondary"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <label htmlFor={inputId} className="sr-only">
                        {`${L.stepTitleLabel} ${index + 1}`}
                      </label>
                      <Input
                        id={inputId}
                        value={step.title}
                        disabled={disabled}
                        placeholder={L.stepTitlePlaceholder}
                        aria-invalid={isEmpty || undefined}
                        aria-describedby={isEmpty ? messageId : undefined}
                        onChange={(event) => onRenameStep(step.id, event.target.value)}
                      />
                      <FieldMessage id={messageId} message={isEmpty ? L.stepTitleRequired : null} />
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={L.moveStepUp}
                        disabled={disabled || isFirst}
                        onClick={() => onMoveStep(step.id, 'up')}
                      >
                        <ArrowUp className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={L.moveStepDown}
                        disabled={disabled || isLast}
                        onClick={() => onMoveStep(step.id, 'down')}
                      >
                        <ArrowDown className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={L.removeStep}
                        disabled={disabled}
                        onClick={() => onRemoveStep(step.id)}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onAddStep}
              disabled={disabled}
            >
              <Plus className="size-4" aria-hidden="true" />
              {L.addStep}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
