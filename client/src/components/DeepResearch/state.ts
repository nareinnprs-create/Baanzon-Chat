import type {
  ResearchEvent,
  ResearchEventKind,
  ResearchPlan,
  ResearchReport,
  ResearchStatus,
  ResearchStep,
} from './types';

/**
 * Pure state machine for the Deep Research flow. No React, no Jotai and no
 * I/O: `deepResearchReducer` maps a state and an action to the next state and
 * appends an entry to the event log on every transition it accepts. Invalid
 * transitions are no-ops, so callers may dispatch optimistically.
 */

/** Terminal failure raised when a plan is run with no steps. */
export const RESEARCH_ERROR_NO_STEPS = 'no_steps';

/** Terminal failure raised when a run reaches the report stage with no plan. */
export const RESEARCH_ERROR_NO_PLAN = 'no_plan';

export type MoveStepDirection = 'up' | 'down';

export type DeepResearchAction =
  | { type: 'start_planning'; topic: string }
  | { type: 'plan_ready'; plan: ResearchPlan }
  | { type: 'run' }
  | { type: 'step_progress'; stepId: string; progress: number; detail?: string }
  | { type: 'step_completed'; stepId: string; detail?: string }
  | { type: 'step_failed'; stepId: string; error: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel' }
  | { type: 'complete'; report: ResearchReport }
  | { type: 'fail'; error: string }
  | { type: 'retry' }
  | { type: 'reset' }
  | { type: 'update_topic'; topic: string }
  | { type: 'add_step' }
  | { type: 'remove_step'; stepId: string }
  | { type: 'rename_step'; stepId: string; title: string }
  | { type: 'move_step'; stepId: string; direction: MoveStepDirection };

export type DeepResearchState = {
  status: ResearchStatus;
  topic: string;
  plan: ResearchPlan | null;
  report: ResearchReport | null;
  error: string | null;
  /** The step a running or paused flow is on. */
  activeStepId: string | null;
  events: ResearchEvent[];
  /** Monotonic counter backing event ids. */
  seq: number;
  /** Monotonic counter backing generated step ids. */
  nextStepNumber: number;
};

export function createInitialState(): DeepResearchState {
  return {
    status: 'idle',
    topic: '',
    plan: null,
    report: null,
    error: null,
    activeStepId: null,
    events: [],
    seq: 0,
    nextStepNumber: 0,
  };
}

/** The plan is only mutable while the flow is waiting for the user to run it. */
export function isPlanEditable(status: ResearchStatus): boolean {
  return status === 'plan_ready';
}

/** The step the run engine should execute next, if any. */
export function selectActiveStep(state: DeepResearchState): ResearchStep | null {
  if (!state.plan) {
    return null;
  }
  if (state.activeStepId) {
    return state.plan.steps.find((step) => step.id === state.activeStepId) ?? null;
  }
  return state.plan.steps.find((step) => step.status === 'pending') ?? null;
}

export function countCompletedSteps(plan: ResearchPlan | null): number {
  if (!plan) {
    return 0;
  }
  return plan.steps.reduce((total, step) => (step.status === 'completed' ? total + 1 : total), 0);
}

function logged(
  state: DeepResearchState,
  kind: ResearchEventKind,
  code: string,
  extra?: { stepId?: string; detail?: string },
): DeepResearchState {
  const seq = state.seq + 1;
  const event: ResearchEvent = {
    id: `event-${seq}`,
    seq,
    kind,
    status: state.status,
    code,
    stepId: extra?.stepId,
    detail: extra?.detail,
  };
  return { ...state, seq, events: [...state.events, event] };
}

function markStep(plan: ResearchPlan, stepId: string, patch: Partial<ResearchStep>): ResearchPlan {
  return {
    ...plan,
    steps: plan.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
  };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function deepResearchReducer(
  state: DeepResearchState,
  action: DeepResearchAction,
): DeepResearchState {
  switch (action.type) {
    case 'start_planning': {
      if (state.status !== 'idle' && state.status !== 'failed' && state.status !== 'cancelled') {
        return state;
      }
      const next: DeepResearchState = {
        ...state,
        status: 'planning',
        topic: action.topic,
        plan: null,
        report: null,
        error: null,
        activeStepId: null,
      };
      return logged(next, 'status', 'planning');
    }

    case 'plan_ready': {
      if (state.status !== 'planning') {
        return state;
      }
      const next: DeepResearchState = {
        ...state,
        status: 'plan_ready',
        plan: action.plan,
        error: null,
        // New steps continue past the ids the executor handed back, so an
        // added step can never collide with an existing one.
        nextStepNumber: action.plan.steps.length,
      };
      return logged(next, 'status', 'plan_ready', { detail: action.plan.topic });
    }

    case 'run': {
      if (state.status !== 'plan_ready') {
        return state;
      }
      if (!state.plan || state.plan.steps.length === 0) {
        const next: DeepResearchState = {
          ...state,
          status: 'failed',
          error: RESEARCH_ERROR_NO_STEPS,
          activeStepId: null,
        };
        return logged(next, 'error', 'run_blocked');
      }
      const firstStep = state.plan.steps[0];
      const plan = markStep(state.plan, firstStep.id, { status: 'running', progress: 0 });
      const next: DeepResearchState = {
        ...state,
        status: 'running',
        plan,
        report: null,
        error: null,
        activeStepId: firstStep.id,
      };
      return logged(next, 'status', 'running', { stepId: firstStep.id });
    }

    case 'step_progress': {
      if (state.status !== 'running' || !state.plan) {
        return state;
      }
      const plan = markStep(state.plan, action.stepId, {
        status: 'running',
        progress: clamp01(action.progress),
        detail: action.detail,
      });
      const next: DeepResearchState = { ...state, plan };
      return logged(next, 'progress', 'step_progress', {
        stepId: action.stepId,
        detail: action.detail,
      });
    }

    case 'step_completed': {
      if (state.status !== 'running' || !state.plan) {
        return state;
      }
      const plan = markStep(state.plan, action.stepId, {
        status: 'completed',
        progress: 1,
        detail: action.detail,
        error: undefined,
      });
      const nextPending = plan.steps.find((step) => step.status === 'pending');
      const withNext = nextPending
        ? markStep(plan, nextPending.id, { status: 'running', progress: 0 })
        : plan;
      const next: DeepResearchState = {
        ...state,
        plan: withNext,
        activeStepId: nextPending?.id ?? null,
      };
      return logged(next, 'step', 'step_completed', { stepId: action.stepId });
    }

    case 'step_failed': {
      if (state.status !== 'running' || !state.plan) {
        return state;
      }
      const plan = markStep(state.plan, action.stepId, {
        status: 'failed',
        error: action.error,
        detail: undefined,
      });
      const next: DeepResearchState = {
        ...state,
        status: 'failed',
        plan,
        error: action.error,
        activeStepId: null,
      };
      return logged(next, 'error', 'step_failed', {
        stepId: action.stepId,
        detail: action.error,
      });
    }

    case 'pause': {
      if (state.status !== 'running' || !state.plan || !state.activeStepId) {
        return state;
      }
      const plan = markStep(state.plan, state.activeStepId, { status: 'paused' });
      const next: DeepResearchState = { ...state, status: 'paused', plan };
      return logged(next, 'status', 'paused', { stepId: state.activeStepId });
    }

    case 'resume': {
      if (state.status !== 'paused' || !state.plan || !state.activeStepId) {
        return state;
      }
      const plan = markStep(state.plan, state.activeStepId, { status: 'running' });
      const next: DeepResearchState = { ...state, status: 'running', plan };
      return logged(next, 'status', 'resumed', { stepId: state.activeStepId });
    }

    case 'cancel': {
      if (state.status !== 'running' && state.status !== 'paused') {
        return state;
      }
      const plan = state.plan
        ? {
            ...state.plan,
            steps: state.plan.steps.map((step) =>
              step.status === 'running' || step.status === 'paused'
                ? { ...step, status: 'pending' as const, progress: 0 }
                : step,
            ),
          }
        : null;
      const next: DeepResearchState = {
        ...state,
        status: 'cancelled',
        plan,
        activeStepId: null,
        error: null,
      };
      return logged(next, 'status', 'cancelled');
    }

    case 'complete': {
      if (state.status !== 'running') {
        return state;
      }
      const next: DeepResearchState = {
        ...state,
        status: 'completed',
        report: action.report,
        error: null,
        activeStepId: null,
      };
      return logged(next, 'report', 'completed', { detail: action.report.title });
    }

    case 'fail': {
      if (state.status !== 'planning' && state.status !== 'running' && state.status !== 'paused') {
        return state;
      }
      const plan =
        state.plan && state.activeStepId
          ? markStep(state.plan, state.activeStepId, { status: 'failed', error: action.error })
          : state.plan;
      const next: DeepResearchState = {
        ...state,
        status: 'failed',
        error: action.error,
        plan,
        activeStepId: null,
      };
      return logged(next, 'error', 'failed', { detail: action.error });
    }

    case 'retry': {
      if (state.status !== 'failed' && state.status !== 'cancelled') {
        return state;
      }
      if (!state.plan || state.plan.steps.length === 0) {
        const empty: DeepResearchState = {
          ...state,
          status: 'idle',
          error: null,
          report: null,
          activeStepId: null,
        };
        return logged(empty, 'status', 'reset');
      }
      const plan = {
        ...state.plan,
        steps: state.plan.steps.map((step) => ({
          ...step,
          status: 'pending' as const,
          progress: 0,
          detail: undefined,
          error: undefined,
        })),
      };
      const next: DeepResearchState = {
        ...state,
        status: 'plan_ready',
        plan,
        error: null,
        report: null,
        activeStepId: null,
      };
      return logged(next, 'status', 'retry');
    }

    case 'reset': {
      return createInitialState();
    }

    case 'update_topic': {
      if (state.status !== 'idle' && !isPlanEditable(state.status)) {
        return state;
      }
      return { ...state, topic: action.topic };
    }

    case 'add_step': {
      if (!state.plan || !isPlanEditable(state.status)) {
        return state;
      }
      const id = `step-${state.nextStepNumber + 1}`;
      const step: ResearchStep = { id, title: '', query: '', status: 'pending', progress: 0 };
      const next: DeepResearchState = {
        ...state,
        plan: { ...state.plan, steps: [...state.plan.steps, step] },
        nextStepNumber: state.nextStepNumber + 1,
      };
      return logged(next, 'step', 'step_added', { stepId: id });
    }

    case 'remove_step': {
      if (!state.plan || !isPlanEditable(state.status)) {
        return state;
      }
      const steps = state.plan.steps.filter((step) => step.id !== action.stepId);
      if (steps.length === state.plan.steps.length) {
        return state;
      }
      const next: DeepResearchState = { ...state, plan: { ...state.plan, steps } };
      return logged(next, 'step', 'step_removed', { stepId: action.stepId });
    }

    case 'rename_step': {
      if (!state.plan || !isPlanEditable(state.status)) {
        return state;
      }
      // Not logged: a keystroke per character would swamp the event log, and
      // the title itself is the interesting state.
      return { ...state, plan: markStep(state.plan, action.stepId, { title: action.title }) };
    }

    case 'move_step': {
      if (!state.plan || !isPlanEditable(state.status)) {
        return state;
      }
      const index = state.plan.steps.findIndex((step) => step.id === action.stepId);
      if (index === -1) {
        return state;
      }
      const target = action.direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= state.plan.steps.length) {
        return state;
      }
      const steps = [...state.plan.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      const next: DeepResearchState = { ...state, plan: { ...state.plan, steps } };
      return logged(next, 'step', 'step_moved', {
        stepId: action.stepId,
        detail: action.direction,
      });
    }

    default:
      return state;
  }
}
