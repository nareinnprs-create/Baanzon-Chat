import type {
  StepResult,
  WorkflowDefinition,
  WorkflowDraft,
  WorkflowStep,
  WorkflowStepDisplayStatus,
} from './types';

/**
 * Pure state machine for the Workflow Builder. No React, no Jotai and no I/O,
 * so every transition is unit-testable without a DOM. `workflowReducer` maps a
 * state and an action to the next state; invalid transitions are no-ops, so
 * callers may dispatch optimistically.
 */

/** Draft-level error code: the draft has no steps at all. */
export const WORKFLOW_ERROR_NO_STEPS = 'no_steps';
/** Draft-level error code: at least one step failed a field-level rule. */
export const WORKFLOW_ERROR_INVALID_STEPS = 'invalid_steps';

export type MoveStepDirection = 'up' | 'down';

/** One field-level validation problem bound to a step. */
export interface WorkflowStepIssue {
  stepId: string;
  code:
    | 'stepIdRequired'
    | 'stepIdUniqueError'
    | 'stepTypeMissingError'
    | 'branchNeedsEdgesError'
    | 'delayNeedsValueError'
    | 'stepInputInvalidJson';
  /** The field the issue attaches to, so the editor can target it. */
  field?: 'id' | 'type' | 'input' | 'onTrue' | 'onFalse' | 'delayMs';
}

export type WorkflowAction =
  | { type: 'set_name'; name: string }
  | { type: 'set_description'; description: string }
  | { type: 'set_draft'; draft: WorkflowDraftState }
  | { type: 'add_step' }
  | { type: 'remove_step'; stepId: string }
  | { type: 'move_step'; stepId: string; direction: MoveStepDirection }
  | { type: 'update_step'; stepId: string; patch: Partial<WorkflowStep> }
  | { type: 'update_step_input_text'; stepId: string; text: string }
  | { type: 'set_definition'; definition: WorkflowDefinition }
  | { type: 'run_started'; runId: string }
  | { type: 'step_started'; runId: string; stepId: string }
  | { type: 'step_retrying'; runId: string; stepId: string }
  | { type: 'step_succeeded'; runId: string; result: StepResult }
  | { type: 'step_failed'; runId: string; result: StepResult }
  | { type: 'step_skipped'; runId: string; result: StepResult }
  | { type: 'run_paused'; runId: string }
  | { type: 'run_resumed'; runId: string }
  | { type: 'run_completed'; runId: string }
  | { type: 'run_failed'; runId: string; error: string }
  | { type: 'run_cancelled'; runId: string }
  | { type: 'select_run'; runId: string | null }
  | { type: 'clear_history' }
  | { type: 'reset' };

/** The editable workflow document plus its live validation result. */
export interface WorkflowDraftState {
  id: string;
  name: string;
  description: string;
  definition: WorkflowDefinition;
  /**
   * Raw JSON text per step for the `input` field, keyed by step id. Kept
   * separate from `WorkflowStep.input` so partially typed JSON stays visible
   * while `issues` reports it instead of silently dropping it.
   */
  inputTexts: Record<string, string>;
  /** Step-scoped issues, in step order. */
  issues: WorkflowStepIssue[];
}

/** Per-run view state: lifecycle, step statuses and progress. */
export interface WorkflowRunState {
  runId: string;
  state: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  stepStatus: Record<string, WorkflowStepDisplayStatus>;
  steps: Record<string, StepResult>;
  /** Normalised progress in the range 0..1. */
  progress: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  activeStepId: string | null;
}

export interface WorkflowState {
  draft: WorkflowDraftState;
  activeRunId: string | null;
  runs: Record<string, WorkflowRunState>;
  /** Run ids in creation order, newest last. */
  runHistory: string[];
  /** Monotonic counter backing generated step ids. */
  nextStepNumber: number;
}

export function createInitialDraft(): WorkflowDraftState {
  return {
    id: 'draft-1',
    name: '',
    description: '',
    definition: { steps: [] },
    inputTexts: {},
    issues: [],
  };
}

export function createInitialState(): WorkflowState {
  return {
    draft: createInitialDraft(),
    activeRunId: null,
    runs: {},
    runHistory: [],
    nextStepNumber: 0,
  };
}

/**
 * Builds a fully-formed draft from a host-supplied workflow document: each
 * step's `input` is rendered back to JSON text and the whole draft is validated
 * so the editor opens already reflecting any problems.
 */
export function createDraftState(input: WorkflowDraft): WorkflowDraftState {
  const inputTexts: Record<string, string> = {};
  for (const step of input.definition.steps) {
    if (step.input != null) {
      inputTexts[step.id] = JSON.stringify(step.input, null, 2);
    }
  }
  const draft: WorkflowDraftState = {
    id: input.id,
    name: input.name,
    description: input.description,
    definition: input.definition,
    inputTexts,
    issues: [],
  };
  return { ...draft, issues: validateDraft(draft) };
}

/** Strips builder-only fields, yielding the runnable/saveable document. */
export function toWorkflowDraft(draft: WorkflowDraftState): WorkflowDraft {
  return {
    id: draft.id,
    name: draft.name,
    description: draft.description,
    definition: draft.definition,
  };
}

/** The draft is saveable/runnable only when it has steps and no issues. */
export function isDraftValid(draft: WorkflowDraftState): boolean {
  return draft.definition.steps.length > 0 && draft.issues.length === 0;
}

/** Draft-level gate: returns the error code blocking save/run, if any. */
export function draftBlocker(draft: WorkflowDraftState): string | null {
  if (draft.definition.steps.length === 0) {
    return WORKFLOW_ERROR_NO_STEPS;
  }
  if (draft.issues.length > 0) {
    return WORKFLOW_ERROR_INVALID_STEPS;
  }
  return null;
}

/** Field issues attached to one step, in validation order. */
export function selectIssuesForStep(
  draft: WorkflowDraftState,
  stepId: string,
): WorkflowStepIssue[] {
  return draft.issues.filter((issue) => issue.stepId === stepId);
}

/**
 * Validates a definition the way the backend normalizer would reject it:
 * missing/duplicate ids, missing type, and the type-specific fields (`branch`
 * edges, non-negative `delay` ms, `input` text that parses to an object).
 * An empty step list is not an issue here - `draftBlocker` owns that gate.
 */
export function validateDraft(draft: WorkflowDraftState): WorkflowStepIssue[] {
  const steps = draft.definition.steps ?? [];
  const issues: WorkflowStepIssue[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    const id = step.id.trim();
    if (!id) {
      issues.push({ stepId: step.id, code: 'stepIdRequired', field: 'id' });
    } else if (seen.has(id)) {
      issues.push({ stepId: step.id, code: 'stepIdUniqueError', field: 'id' });
    } else {
      seen.add(id);
    }
    if (!step.type) {
      issues.push({ stepId: step.id, code: 'stepTypeMissingError', field: 'type' });
    }
    if (step.type === 'branch') {
      if (!step.onTrue) {
        issues.push({ stepId: step.id, code: 'branchNeedsEdgesError', field: 'onTrue' });
      }
      if (!step.onFalse) {
        issues.push({ stepId: step.id, code: 'branchNeedsEdgesError', field: 'onFalse' });
      }
    }
    if (step.type === 'delay' && (typeof step.delayMs !== 'number' || step.delayMs < 0)) {
      issues.push({ stepId: step.id, code: 'delayNeedsValueError', field: 'delayMs' });
    }
    const text = draft.inputTexts[step.id];
    if (text != null && text.trim().length > 0 && !parsesToObject(text)) {
      issues.push({ stepId: step.id, code: 'stepInputInvalidJson', field: 'input' });
    }
  }
  return issues;
}

function parsesToObject(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false;
    }
    const proto = Object.getPrototypeOf(parsed) as object | null;
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
}

/** Parses a valid `input` text into its object, or `undefined` when invalid/blank. */
export function parseInputText(text: string): Record<string, unknown> | undefined {
  if (text.trim().length === 0) {
    return undefined;
  }
  if (!parsesToObject(text)) {
    return undefined;
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function withDraft(state: WorkflowState, definition: WorkflowDefinition): WorkflowState {
  const nextDraft: WorkflowDraftState = { ...state.draft, definition };
  return { ...state, draft: { ...nextDraft, issues: validateDraft(nextDraft) } };
}

function withDraftFull(state: WorkflowState, draft: WorkflowDraftState): WorkflowState {
  return { ...state, draft: { ...draft, issues: validateDraft(draft) } };
}

function uniqueStepId(steps: WorkflowStep[], nextStepNumber: number): string {
  const ids = new Set(steps.map((step) => step.id));
  let n = nextStepNumber;
  let candidate = `step-${n}`;
  while (ids.has(candidate)) {
    n += 1;
    candidate = `step-${n}`;
  }
  return candidate;
}

function calcProgress(
  definition: WorkflowDefinition,
  stepStatus: Record<string, WorkflowStepDisplayStatus>,
): number {
  const steps = definition.steps ?? [];
  if (steps.length === 0) {
    return 0;
  }
  const settled = steps.filter(
    (step) => stepStatus[step.id] === 'completed' || stepStatus[step.id] === 'skipped',
  ).length;
  return settled / steps.length;
}

function patchRun(
  state: WorkflowState,
  runId: string,
  patch: (run: WorkflowRunState) => WorkflowRunState,
): WorkflowState {
  const run = state.runs[runId];
  if (!run) {
    return state;
  }
  return { ...state, runs: { ...state.runs, [runId]: patch(run) } };
}

function settleStep(
  state: WorkflowState,
  action: { runId: string; result: StepResult },
  status: WorkflowStepDisplayStatus,
  extra: (run: WorkflowRunState) => Partial<WorkflowRunState>,
): WorkflowState {
  return patchRun(state, action.runId, (run) => {
    const stepStatus = { ...run.stepStatus, [action.result.stepId]: status };
    return {
      ...run,
      ...extra(run),
      stepStatus,
      steps: { ...run.steps, [action.result.stepId]: action.result },
      progress: calcProgress(state.draft.definition, stepStatus),
    };
  });
}

export function workflowReducer(state: WorkflowState, action: WorkflowAction): WorkflowState {
  switch (action.type) {
    case 'set_name':
      return { ...state, draft: { ...state.draft, name: action.name } };
    case 'set_description':
      return { ...state, draft: { ...state.draft, description: action.description } };
    case 'set_draft':
      return withDraftFull(state, action.draft);
    case 'add_step': {
      const steps = state.draft.definition.steps;
      const id = uniqueStepId(steps, state.nextStepNumber);
      const definition: WorkflowDefinition = {
        ...state.draft.definition,
        steps: [...steps, { id, type: 'custom', name: '', input: {} }],
      };
      const next = withDraft(state, definition);
      return { ...next, nextStepNumber: state.nextStepNumber + 1 };
    }
    case 'remove_step': {
      const steps = state.draft.definition.steps.filter((step) => step.id !== action.stepId);
      const inputTexts = { ...state.draft.inputTexts };
      delete inputTexts[action.stepId];
      return withDraftFull(state, {
        ...state.draft,
        definition: { ...state.draft.definition, steps },
        inputTexts,
      });
    }
    case 'move_step': {
      const steps = [...state.draft.definition.steps];
      const from = steps.findIndex((step) => step.id === action.stepId);
      if (from === -1) {
        return state;
      }
      const to = action.direction === 'up' ? from - 1 : from + 1;
      if (to < 0 || to >= steps.length) {
        return state;
      }
      const moved = steps.splice(from, 1)[0] as WorkflowStep;
      steps.splice(to, 0, moved);
      return withDraft(state, { ...state.draft.definition, steps });
    }
    case 'update_step': {
      const steps = state.draft.definition.steps.map((step) =>
        step.id === action.stepId ? { ...step, ...action.patch } : step,
      );
      const inputTexts = { ...state.draft.inputTexts };
      if (action.patch.id != null && action.patch.id !== action.stepId) {
        const text = inputTexts[action.stepId];
        if (text != null) {
          delete inputTexts[action.stepId];
          inputTexts[action.patch.id] = text;
        }
      }
      return withDraftFull(state, {
        ...state.draft,
        definition: { ...state.draft.definition, steps },
        inputTexts,
      });
    }
    case 'update_step_input_text': {
      const trimmed = action.text.trim();
      const steps = state.draft.definition.steps.map((step) =>
        step.id === action.stepId
          ? { ...step, input: trimmed.length === 0 ? undefined : parseInputText(action.text) }
          : step,
      );
      return withDraftFull(state, {
        ...state.draft,
        definition: { ...state.draft.definition, steps },
        inputTexts: { ...state.draft.inputTexts, [action.stepId]: action.text },
      });
    }
    case 'set_definition':
      return withDraft(state, action.definition);
    case 'run_started': {
      const stepStatus: Record<string, WorkflowStepDisplayStatus> = {};
      state.draft.definition.steps.forEach((step) => {
        stepStatus[step.id] = 'pending';
      });
      const run: WorkflowRunState = {
        runId: action.runId,
        state: 'queued',
        stepStatus,
        steps: {},
        progress: 0,
        startedAt: new Date().toISOString(),
        activeStepId: null,
      };
      return {
        ...state,
        activeRunId: action.runId,
        runs: { ...state.runs, [action.runId]: run },
        runHistory: [...state.runHistory, action.runId],
      };
    }
    case 'step_started':
      return patchRun(state, action.runId, (run) => ({
        ...run,
        state: 'running',
        activeStepId: action.stepId,
        stepStatus: { ...run.stepStatus, [action.stepId]: 'running' },
      }));
    case 'step_retrying':
      return patchRun(state, action.runId, (run) => ({
        ...run,
        stepStatus: { ...run.stepStatus, [action.stepId]: 'running' },
      }));
    case 'step_succeeded':
      return settleStep(state, action, 'completed', (run) => ({
        activeStepId: null,
        state: run.state === 'queued' ? 'running' : run.state,
      }));
    case 'step_skipped':
      return settleStep(state, action, 'skipped', (run) => ({
        activeStepId: null,
        state: run.state === 'queued' ? 'running' : run.state,
      }));
    case 'step_failed':
      return settleStep(state, action, 'failed', () => ({
        state: 'failed',
        activeStepId: null,
        error: action.result.error,
        finishedAt: action.result.finishedAt,
      }));
    case 'run_paused':
      return patchRun(state, action.runId, (run) => ({ ...run, state: 'paused' }));
    case 'run_resumed':
      return patchRun(state, action.runId, (run) => ({ ...run, state: 'running' }));
    case 'run_completed':
      return patchRun(state, action.runId, (run) => ({
        ...run,
        state: 'completed',
        progress: 1,
        activeStepId: null,
        finishedAt: new Date().toISOString(),
      }));
    case 'run_failed':
      return patchRun(state, action.runId, (run) => ({
        ...run,
        state: 'failed',
        error: action.error,
        activeStepId: null,
        finishedAt: new Date().toISOString(),
      }));
    case 'run_cancelled':
      return patchRun(state, action.runId, (run) => ({
        ...run,
        state: 'cancelled',
        activeStepId: null,
        finishedAt: new Date().toISOString(),
      }));
    case 'select_run':
      return { ...state, activeRunId: action.runId };
    case 'clear_history':
      return { ...state, runs: {}, runHistory: [], activeRunId: null };
    case 'reset':
      return createInitialState();
    default:
      return state;
  }
}
