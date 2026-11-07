import type { ResearchPlan, ResearchReport, ResearchStep } from '../types';
import type { DeepResearchAction, DeepResearchState } from '../state';
import {
  RESEARCH_ERROR_NO_STEPS,
  countCompletedSteps,
  createInitialState,
  deepResearchReducer,
  isPlanEditable,
  selectActiveStep,
} from '../state';

function makeStep(id: string, title = id): ResearchStep {
  return { id, title, query: `query-${id}`, status: 'pending', progress: 0 };
}

function makePlan(stepCount = 2): ResearchPlan {
  return {
    id: 'plan-1',
    topic: 'Topic',
    steps: Array.from({ length: stepCount }, (_value, index) => makeStep(`step-${index + 1}`)),
  };
}

function makeReport(plan: ResearchPlan): ResearchReport {
  return {
    planId: plan.id,
    title: 'Report',
    summary: 'Done',
    sections: [],
    citations: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** Reduces a list of actions over an initial state; the common test shorthand. */
function run(actions: DeepResearchAction[], initial: DeepResearchState = createInitialState()) {
  return actions.reduce(deepResearchReducer, initial);
}

/** Drives the flow to a running state with the supplied plan. */
function running(plan: ResearchPlan = makePlan()): DeepResearchState {
  return run([
    { type: 'start_planning', topic: 'Topic' },
    { type: 'plan_ready', plan },
    { type: 'run' },
  ]);
}

describe('createInitialState', () => {
  it('starts idle with no plan, report or events', () => {
    const state = createInitialState();
    expect(state.status).toBe('idle');
    expect(state.plan).toBeNull();
    expect(state.report).toBeNull();
    expect(state.error).toBeNull();
    expect(state.events).toEqual([]);
  });
});

describe('deepResearchReducer lifecycle', () => {
  it('walks idle -> planning -> plan_ready -> running -> completed', () => {
    const plan = makePlan(2);
    let state = run([{ type: 'start_planning', topic: 'Topic' }]);
    expect(state.status).toBe('planning');

    state = deepResearchReducer(state, { type: 'plan_ready', plan });
    expect(state.status).toBe('plan_ready');
    expect(state.plan).toBe(plan);

    state = deepResearchReducer(state, { type: 'run' });
    expect(state.status).toBe('running');
    expect(state.activeStepId).toBe('step-1');
    expect(state.plan?.steps[0].status).toBe('running');

    state = deepResearchReducer(state, {
      type: 'step_progress',
      stepId: 'step-1',
      progress: 0.5,
      detail: 'halfway',
    });
    expect(state.plan?.steps[0].progress).toBe(0.5);
    expect(state.plan?.steps[0].detail).toBe('halfway');

    state = deepResearchReducer(state, {
      type: 'step_completed',
      stepId: 'step-1',
      detail: 'ok',
    });
    expect(state.plan?.steps[0].status).toBe('completed');
    expect(state.activeStepId).toBe('step-2');
    expect(state.plan?.steps[1].status).toBe('running');

    state = deepResearchReducer(state, { type: 'step_completed', stepId: 'step-2' });
    expect(state.activeStepId).toBeNull();
    expect(state.status).toBe('running');

    const report = makeReport(plan);
    state = deepResearchReducer(state, { type: 'complete', report });
    expect(state.status).toBe('completed');
    expect(state.report).toBe(report);
  });

  it('clamps progress into the 0..1 range', () => {
    let state = running();
    state = deepResearchReducer(state, {
      type: 'step_progress',
      stepId: 'step-1',
      progress: 4,
    });
    expect(state.plan?.steps[0].progress).toBe(1);
    state = deepResearchReducer(state, {
      type: 'step_progress',
      stepId: 'step-1',
      progress: -2,
    });
    expect(state.plan?.steps[0].progress).toBe(0);
  });

  it('pauses and resumes the active step', () => {
    let state = running();
    state = deepResearchReducer(state, { type: 'pause' });
    expect(state.status).toBe('paused');
    expect(state.activeStepId).toBe('step-1');
    expect(state.plan?.steps[0].status).toBe('paused');

    state = deepResearchReducer(state, { type: 'resume' });
    expect(state.status).toBe('running');
    expect(state.plan?.steps[0].status).toBe('running');
  });

  it('cancels a run and returns the in-flight step to pending', () => {
    let state = running();
    state = deepResearchReducer(state, { type: 'pause' });
    state = deepResearchReducer(state, { type: 'cancel' });
    expect(state.status).toBe('cancelled');
    expect(state.activeStepId).toBeNull();
    expect(state.plan?.steps[0].status).toBe('pending');
    expect(state.plan?.steps[0].progress).toBe(0);
    expect(state.error).toBeNull();
  });

  it('fails the flow when a step fails', () => {
    let state = running();
    state = deepResearchReducer(state, {
      type: 'step_failed',
      stepId: 'step-1',
      error: 'Boom',
    });
    expect(state.status).toBe('failed');
    expect(state.error).toBe('Boom');
    expect(state.plan?.steps[0].status).toBe('failed');
    expect(state.plan?.steps[0].error).toBe('Boom');
  });

  it('fails the flow from planning, e.g. when the plan request errors', () => {
    const state = run([
      { type: 'start_planning', topic: 'Topic' },
      { type: 'fail', error: 'Plan unavailable' },
    ]);
    expect(state.status).toBe('failed');
    expect(state.error).toBe('Plan unavailable');
  });

  it('blocks a run with no steps and reports a symbolic error code', () => {
    const state = run([
      { type: 'start_planning', topic: 'Topic' },
      { type: 'plan_ready', plan: makePlan(0) },
      { type: 'run' },
    ]);
    expect(state.status).toBe('failed');
    expect(state.error).toBe(RESEARCH_ERROR_NO_STEPS);
  });

  it('retries a failed run back to an editable plan with reset steps', () => {
    let state = running();
    state = deepResearchReducer(state, {
      type: 'step_failed',
      stepId: 'step-1',
      error: 'Boom',
    });
    state = deepResearchReducer(state, { type: 'retry' });
    expect(state.status).toBe('plan_ready');
    expect(state.error).toBeNull();
    expect(state.report).toBeNull();
    expect(state.plan?.steps.every((step) => step.status === 'pending')).toBe(true);
    expect(state.plan?.steps.every((step) => step.progress === 0)).toBe(true);
    expect(state.plan?.steps.every((step) => step.error === undefined)).toBe(true);
  });

  it('resets the whole flow from a cancellation', () => {
    let state = running();
    state = deepResearchReducer(state, { type: 'cancel' });
    state = deepResearchReducer(state, { type: 'reset' });
    expect(state).toEqual(createInitialState());
  });
});

describe('deepResearchReducer invalid transitions', () => {
  it('ignores pause, resume, cancel and complete when idle', () => {
    const idle = createInitialState();
    expect(deepResearchReducer(idle, { type: 'pause' })).toBe(idle);
    expect(deepResearchReducer(idle, { type: 'resume' })).toBe(idle);
    expect(deepResearchReducer(idle, { type: 'cancel' })).toBe(idle);
    expect(deepResearchReducer(idle, { type: 'complete', report: makeReport(makePlan()) })).toBe(
      idle,
    );
  });

  it('ignores run and pause before a plan is ready', () => {
    const planning = run([{ type: 'start_planning', topic: 'Topic' }]);
    expect(deepResearchReducer(planning, { type: 'run' })).toBe(planning);
    const planReady = deepResearchReducer(planning, { type: 'plan_ready', plan: makePlan() });
    expect(deepResearchReducer(planReady, { type: 'pause' })).toBe(planReady);
    expect(deepResearchReducer(planReady, { type: 'step_completed', stepId: 'step-1' })).toBe(
      planReady,
    );
  });

  it('will not edit the plan once it is running', () => {
    const state = running();
    expect(deepResearchReducer(state, { type: 'add_step' })).toBe(state);
    expect(deepResearchReducer(state, { type: 'remove_step', stepId: 'step-1' })).toBe(state);
    expect(deepResearchReducer(state, { type: 'rename_step', stepId: 'step-1', title: 'x' })).toBe(
      state,
    );
    expect(
      deepResearchReducer(state, { type: 'move_step', stepId: 'step-1', direction: 'down' }),
    ).toBe(state);
    expect(deepResearchReducer(state, { type: 'update_topic', topic: 'x' })).toBe(state);
  });
});

describe('deepResearchReducer plan editing', () => {
  function editable() {
    return run([
      { type: 'start_planning', topic: 'Topic' },
      { type: 'plan_ready', plan: makePlan(2) },
    ]);
  }

  it('adds a step past the ids the executor handed back', () => {
    let state = editable();
    state = deepResearchReducer(state, { type: 'add_step' });
    expect(state.plan?.steps).toHaveLength(3);
    expect(state.plan?.steps[2].id).toBe('step-3');
    state = deepResearchReducer(state, { type: 'remove_step', stepId: 'step-2' });
    state = deepResearchReducer(state, { type: 'add_step' });
    expect(state.plan?.steps.map((step) => step.id)).toEqual(['step-1', 'step-3', 'step-4']);
  });

  it('removes a step and ignores an unknown id', () => {
    let state = editable();
    state = deepResearchReducer(state, { type: 'remove_step', stepId: 'step-1' });
    expect(state.plan?.steps.map((step) => step.id)).toEqual(['step-2']);
    const after = deepResearchReducer(state, { type: 'remove_step', stepId: 'missing' });
    expect(after).toBe(state);
  });

  it('renames a step without logging every keystroke', () => {
    let state = editable();
    const before = state.events.length;
    state = deepResearchReducer(state, {
      type: 'rename_step',
      stepId: 'step-1',
      title: 'Renamed',
    });
    expect(state.plan?.steps[0].title).toBe('Renamed');
    expect(state.events).toHaveLength(before);
  });

  it('reorders steps with move_step and stops at the ends', () => {
    let state = editable();
    state = deepResearchReducer(state, { type: 'move_step', stepId: 'step-2', direction: 'up' });
    expect(state.plan?.steps.map((step) => step.id)).toEqual(['step-2', 'step-1']);

    const atTop = deepResearchReducer(state, {
      type: 'move_step',
      stepId: 'step-2',
      direction: 'up',
    });
    expect(atTop).toBe(state);

    const atBottom = deepResearchReducer(state, {
      type: 'move_step',
      stepId: 'step-1',
      direction: 'down',
    });
    expect(atBottom).toBe(state);
  });

  it('updates the topic while the plan is editable', () => {
    let state = editable();
    state = deepResearchReducer(state, { type: 'update_topic', topic: 'New topic' });
    expect(state.topic).toBe('New topic');
  });
});

describe('event log', () => {
  it('appends a stable, symbolic entry per accepted transition', () => {
    const state = running();
    expect(state.events.map((event) => event.code)).toEqual(['planning', 'plan_ready', 'running']);
    expect(state.events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(state.events[2]).toMatchObject({ kind: 'status', status: 'running', stepId: 'step-1' });
  });

  it('records pause, resume and cancel', () => {
    const state = run([
      { type: 'start_planning', topic: 'Topic' },
      { type: 'plan_ready', plan: makePlan() },
      { type: 'run' },
      { type: 'pause' },
      { type: 'resume' },
      { type: 'cancel' },
    ]);
    expect(state.events.map((event) => event.code)).toEqual([
      'planning',
      'plan_ready',
      'running',
      'paused',
      'resumed',
      'cancelled',
    ]);
  });
});

describe('selectors', () => {
  it('exposes the active step and completed count', () => {
    const state = running();
    expect(selectActiveStep(state)?.id).toBe('step-1');
    expect(countCompletedSteps(state.plan)).toBe(0);
  });

  it('falls back to the first pending step when none is active', () => {
    const plan = makePlan(2);
    plan.steps[0] = { ...plan.steps[0], status: 'completed', progress: 1 };
    const state = run([
      { type: 'start_planning', topic: 'Topic' },
      { type: 'plan_ready', plan },
    ]);
    expect(selectActiveStep(state)?.id).toBe('step-2');
    expect(countCompletedSteps(plan)).toBe(1);
  });

  it('treats only plan_ready as editable', () => {
    expect(isPlanEditable('plan_ready')).toBe(true);
    expect(isPlanEditable('running')).toBe(false);
    expect(isPlanEditable('paused')).toBe(false);
  });
});
