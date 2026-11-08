import { useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Alert, Button, EmptyState, Input, Label, Textarea } from '@librechat/client';
import type { ChangeEvent } from 'react';
import type { WorkflowDraft, WorkflowStep, WorkflowStepType } from './types';
import type { WorkflowAction, WorkflowStepIssue } from './state';
import {
  dispatchWorkflowAtom,
  workflowDraftAtom,
  workflowNameValidAtom,
  workflowReadyAtom,
} from './atoms';
import { WORKFLOW_LABELS as L } from './labels';
import { toWorkflowDraft } from './state';
import { cn } from '~/utils';

/**
 * Defines and edits a workflow: name, description and the ordered step list.
 * Every field is validated inline through the reducer, so the same issues gate
 * the save and run actions here and the run button in {@link WorkflowRunPanel}.
 */

export interface WorkflowEditorProps {
  className?: string;
  /** Called with the validated document when the user saves. */
  onSave?: (workflow: WorkflowDraft) => void;
  /** Called with the validated document when the user runs it. */
  onRun?: (workflow: WorkflowDraft) => void;
}

const STEP_TYPE_OPTIONS: ReadonlyArray<{ value: WorkflowStepType; label: string }> = [
  { value: 'transform', label: L.stepTypeTransform },
  { value: 'http', label: L.stepTypeHttp },
  { value: 'tool', label: L.stepTypeTool },
  { value: 'branch', label: L.stepTypeBranch },
  { value: 'delay', label: L.stepTypeDelay },
  { value: 'custom', label: L.stepTypeCustom },
];

const ISSUE_MESSAGES: Record<WorkflowStepIssue['code'], string> = {
  stepIdRequired: L.stepIdRequired,
  stepIdUniqueError: L.stepIdUniqueError,
  stepTypeMissingError: L.stepTypeMissingError,
  branchNeedsEdgesError: L.branchNeedsEdgesError,
  delayNeedsValueError: L.delayNeedsValueError,
  stepInputInvalidJson: L.stepInputInvalidJson,
};

function fieldIssue(
  issues: WorkflowStepIssue[],
  stepId: string,
  field: WorkflowStepIssue['field'],
): WorkflowStepIssue | undefined {
  return issues.find((issue) => issue.stepId === stepId && issue.field === field);
}

function parsePositive(value: string): number | undefined {
  if (value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegative(value: string): number | undefined {
  if (value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

interface FieldMessageProps {
  id: string;
  issue: WorkflowStepIssue | undefined;
}

function FieldMessage({ id, issue }: FieldMessageProps) {
  if (issue == null) {
    return null;
  }
  return (
    <p id={id} className="text-xs text-status-error">
      {ISSUE_MESSAGES[issue.code]}
    </p>
  );
}

interface StepFieldsProps {
  step: WorkflowStep;
  index: number;
  total: number;
  inputText: string;
  issues: WorkflowStepIssue[];
  dispatch: (action: WorkflowAction) => void;
}

function StepFields({ step, index, total, inputText, issues, dispatch }: StepFieldsProps) {
  const idPrefix = `workflow-step-${index}`;
  const idIssue = fieldIssue(issues, step.id, 'id');
  const typeIssue = fieldIssue(issues, step.id, 'type');
  const inputIssue = fieldIssue(issues, step.id, 'input');
  const onTrueIssue = fieldIssue(issues, step.id, 'onTrue');
  const onFalseIssue = fieldIssue(issues, step.id, 'onFalse');
  const delayIssue = fieldIssue(issues, step.id, 'delayMs');
  const retry = step.retry;

  const patch = (value: Partial<WorkflowStep>) =>
    dispatch({ type: 'update_step', stepId: step.id, patch: value });

  const setOptionalString = (key: 'next' | 'onTrue' | 'onFalse') => (value: string) => {
    const next = value.trim() === '' ? undefined : value;
    if (key === 'next') {
      patch({ next });
      return;
    }
    if (key === 'onTrue') {
      patch({ onTrue: next });
      return;
    }
    patch({ onFalse: next });
  };

  const onRetryAttempts = (event: ChangeEvent<HTMLInputElement>) => {
    const maxAttempts = parsePositive(event.target.value);
    if (maxAttempts == null) {
      patch({ retry: undefined });
      return;
    }
    patch({
      retry: {
        maxAttempts,
        backoffMs: retry?.backoffMs ?? 0,
        ...(retry?.backoffMultiplier != null ? { backoffMultiplier: retry.backoffMultiplier } : {}),
        ...(retry?.maxBackoffMs != null ? { maxBackoffMs: retry.maxBackoffMs } : {}),
      },
    });
  };

  const onRetryBackoff = (event: ChangeEvent<HTMLInputElement>) => {
    const backoffMs = parseNonNegative(event.target.value) ?? 0;
    patch({
      retry: {
        maxAttempts: retry?.maxAttempts ?? 1,
        backoffMs,
        ...(retry?.backoffMultiplier != null ? { backoffMultiplier: retry.backoffMultiplier } : {}),
        ...(retry?.maxBackoffMs != null ? { maxBackoffMs: retry.maxBackoffMs } : {}),
      },
    });
  };

  return (
    <fieldset
      data-testid="workflow-step"
      className="flex flex-col gap-3 rounded-lg border border-border-light p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <legend className="px-1 text-sm font-medium text-text-primary">
          {`${L.stepHeader} ${index + 1}`}
        </legend>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={L.moveStepUp}
            disabled={index === 0}
            onClick={() => dispatch({ type: 'move_step', stepId: step.id, direction: 'up' })}
          >
            <ChevronUp className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={L.moveStepDown}
            disabled={index === total - 1}
            onClick={() => dispatch({ type: 'move_step', stepId: step.id, direction: 'down' })}
          >
            <ChevronDown className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={L.removeStep}
            onClick={() => dispatch({ type: 'remove_step', stepId: step.id })}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-id`}>{L.stepIdLabel}</Label>
          <Input
            id={`${idPrefix}-id`}
            value={step.id}
            placeholder={L.stepIdPlaceholder}
            aria-invalid={idIssue != null}
            aria-describedby={idIssue != null ? `${idPrefix}-id-error` : undefined}
            onChange={(event) => patch({ id: event.target.value })}
          />
          <FieldMessage id={`${idPrefix}-id-error`} issue={idIssue} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-type`}>{L.stepTypeLabel}</Label>
          <select
            id={`${idPrefix}-type`}
            value={step.type}
            aria-invalid={typeIssue != null}
            aria-describedby={typeIssue != null ? `${idPrefix}-type-error` : undefined}
            className="h-9 w-full rounded-lg border border-border-medium bg-transparent px-3 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
            onChange={(event) => patch({ type: event.target.value as WorkflowStepType })}
          >
            {STEP_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldMessage id={`${idPrefix}-type-error`} issue={typeIssue} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-name`}>{L.stepNameLabel}</Label>
        <Input
          id={`${idPrefix}-name`}
          value={step.name ?? ''}
          placeholder={L.stepNamePlaceholder}
          onChange={(event) => patch({ name: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-input`}>{L.stepInputLabel}</Label>
        <Textarea
          id={`${idPrefix}-input`}
          value={inputText}
          placeholder={L.stepInputPlaceholder}
          aria-invalid={inputIssue != null}
          aria-describedby={inputIssue != null ? `${idPrefix}-input-error` : undefined}
          onChange={(event) =>
            dispatch({ type: 'update_step_input_text', stepId: step.id, text: event.target.value })
          }
        />
        <FieldMessage id={`${idPrefix}-input-error`} issue={inputIssue} />
      </div>

      {step.type === 'branch' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${idPrefix}-on-true`}>{L.stepOnTrueLabel}</Label>
            <Input
              id={`${idPrefix}-on-true`}
              value={step.onTrue ?? ''}
              aria-invalid={onTrueIssue != null}
              aria-describedby={onTrueIssue != null ? `${idPrefix}-on-true-error` : undefined}
              onChange={(event) => setOptionalString('onTrue')(event.target.value)}
            />
            <FieldMessage id={`${idPrefix}-on-true-error`} issue={onTrueIssue} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${idPrefix}-on-false`}>{L.stepOnFalseLabel}</Label>
            <Input
              id={`${idPrefix}-on-false`}
              value={step.onFalse ?? ''}
              aria-invalid={onFalseIssue != null}
              aria-describedby={onFalseIssue != null ? `${idPrefix}-on-false-error` : undefined}
              onChange={(event) => setOptionalString('onFalse')(event.target.value)}
            />
            <FieldMessage id={`${idPrefix}-on-false-error`} issue={onFalseIssue} />
          </div>
        </div>
      ) : null}

      {step.type === 'delay' ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-delay`}>{L.stepDelayLabel}</Label>
          <Input
            id={`${idPrefix}-delay`}
            type="number"
            min="0"
            value={step.delayMs ?? ''}
            aria-invalid={delayIssue != null}
            aria-describedby={delayIssue != null ? `${idPrefix}-delay-error` : undefined}
            onChange={(event) => patch({ delayMs: parseNonNegative(event.target.value) })}
          />
          <FieldMessage id={`${idPrefix}-delay-error`} issue={delayIssue} />
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-next`}>{L.stepNextLabel}</Label>
          <Input
            id={`${idPrefix}-next`}
            value={step.next ?? ''}
            placeholder={L.stepNextPlaceholder}
            onChange={(event) => setOptionalString('next')(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-timeout`}>{L.stepTimeoutLabel}</Label>
          <Input
            id={`${idPrefix}-timeout`}
            type="number"
            min="0"
            value={step.timeoutMs ?? ''}
            onChange={(event) => patch({ timeoutMs: parsePositive(event.target.value) })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-retry`}>{L.stepRetryLabel}</Label>
          <Input
            id={`${idPrefix}-retry`}
            type="number"
            min="1"
            value={retry?.maxAttempts ?? ''}
            onChange={onRetryAttempts}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-backoff`}>{L.stepBackoffLabel}</Label>
          <Input
            id={`${idPrefix}-backoff`}
            type="number"
            min="0"
            value={retry?.backoffMs ?? ''}
            onChange={onRetryBackoff}
          />
        </div>
      </div>
    </fieldset>
  );
}

export default function WorkflowEditor({ className, onSave, onRun }: WorkflowEditorProps) {
  const draft = useAtomValue(workflowDraftAtom);
  const ready = useAtomValue(workflowReadyAtom);
  const nameValid = useAtomValue(workflowNameValidAtom);
  const dispatch = useSetAtom(dispatchWorkflowAtom);
  const [saved, setSaved] = useState(false);

  const steps = draft.definition.steps;
  const hasIssues = draft.issues.length > 0;

  const handleSave = () => {
    if (!ready) {
      return;
    }
    setSaved(true);
    onSave?.(toWorkflowDraft(draft));
  };

  const handleRun = () => {
    if (!ready) {
      return;
    }
    onRun?.(toWorkflowDraft(draft));
  };

  return (
    <section
      aria-label={L.editorHeading}
      data-testid="workflow-editor"
      className={cn('flex flex-col gap-4', className)}
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-text-primary">{L.editorHeading}</h2>
        <p className="text-sm text-text-secondary">{L.featureDescription}</p>
      </header>

      <div className="flex flex-col gap-1">
        <Label htmlFor="workflow-name">{L.workflowNameLabel}</Label>
        <Input
          id="workflow-name"
          value={draft.name}
          placeholder={L.workflowNamePlaceholder}
          aria-invalid={!nameValid}
          aria-describedby={!nameValid ? 'workflow-name-error' : undefined}
          onChange={(event) => dispatch({ type: 'set_name', name: event.target.value })}
        />
        {!nameValid ? (
          <p id="workflow-name-error" className="text-xs text-status-error">
            {L.nameRequired}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="workflow-description">{L.workflowDescriptionLabel}</Label>
        <Textarea
          id="workflow-description"
          value={draft.description}
          placeholder={L.workflowDescriptionPlaceholder}
          onChange={(event) =>
            dispatch({ type: 'set_description', description: event.target.value })
          }
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">{L.stepsHeading}</h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => dispatch({ type: 'add_step' })}
        >
          <Plus className="size-4" aria-hidden="true" />
          {L.addStep}
        </Button>
      </div>

      {steps.length === 0 ? (
        <EmptyState icon={Plus} title={L.noStepsTitle} description={L.noStepsDescription} />
      ) : (
        <ol className="flex flex-col gap-3">
          {steps.map((step, index) => (
            <li key={index}>
              <StepFields
                step={step}
                index={index}
                total={steps.length}
                inputText={draft.inputTexts[step.id] ?? ''}
                issues={draft.issues}
                dispatch={dispatch}
              />
            </li>
          ))}
        </ol>
      )}

      {steps.length === 0 ? <Alert variant="warning">{L.stepsEmptyError}</Alert> : null}
      {hasIssues ? <Alert variant="error">{L.invalidStepsError}</Alert> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={!ready} onClick={handleSave}>
          {L.saveWorkflow}
        </Button>
        <Button type="button" variant="outline" disabled={!ready} onClick={handleRun}>
          {L.runStart}
        </Button>
        {saved ? (
          <p role="status" className="text-sm text-text-secondary">
            {L.savedMessage}
          </p>
        ) : null}
      </div>
    </section>
  );
}
