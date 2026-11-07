import type { StepResult, WorkflowDraft, WorkflowStep, WorkflowStepResultStatus } from '../types';
import type { WorkflowDraftState } from '../state';
import {
  createDraftState,
  createInitialState,
  draftBlocker,
  isDraftValid,
  toWorkflowDraft,
  validateDraft,
  workflowReducer,
} from '../state';

function step(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return { id: 'a', type: 'custom', name: '', input: {}, ...overrides };
}

function document(steps: WorkflowStep[]): WorkflowDraft {
  return { id: 'draft-1', name: 'Flow', description: '', definition: { steps } };
}

function draftState(
  steps: WorkflowStep[],
  inputTexts: Record<string, string> = {},
): WorkflowDraftState {
  return {
    id: 'draft-1',
    name: 'Flow',
    description: '',
    definition: { steps },
    inputTexts,
    issues: [],
  };
}

function result(stepId: string, status: WorkflowStepResultStatus): StepResult {
  return {
    stepId,
    status,
    attempts: 1,
    startedAt: '2024-01-01T00:00:00.000Z',
    finishedAt: '2024-01-01T00:00:00.000Z',
    durationMs: 0,
    error: status === 'failed' ? 'boom' : undefined,
  };
}

describe('workflow state', () => {
  describe('createDraftState', () => {
    it('renders step input back to JSON text and validates the draft', () => {
      const draft = createDraftState(document([step({ id: 'a', input: { k: 1 } })]));

      expect(draft.inputTexts.a).toBe('{\n  "k": 1\n}');
      expect(draft.issues).toEqual([]);
    });

    it('reports issues for an invalid document', () => {
      const draft = createDraftState(document([step({ id: '', type: 'branch' })]));
      const codes = draft.issues.map((issue) => issue.code);

      expect(codes).toContain('stepIdRequired');
      expect(codes).toContain('branchNeedsEdgesError');
    });
  });

  it('toWorkflowDraft strips builder-only fields', () => {
    const draft = draftState([step()], { a: '{}' });

    expect(toWorkflowDraft(draft)).toEqual({
      id: 'draft-1',
      name: 'Flow',
      description: '',
      definition: { steps: [step()] },
    });
  });

  describe('validateDraft', () => {
    it('flags duplicate ids', () => {
      const codes = validateDraft(draftState([step({ id: 'a' }), step({ id: 'a' })])).map(
        (issue) => issue.code,
      );

      expect(codes).toContain('stepIdUniqueError');
    });

    it('flags a delay step without a value', () => {
      const codes = validateDraft(draftState([step({ id: 'a', type: 'delay' })])).map(
        (issue) => issue.code,
      );

      expect(codes).toContain('delayNeedsValueError');
    });

    it('flags unparseable input text', () => {
      const codes = validateDraft(draftState([step()], { a: '{' })).map((issue) => issue.code);

      expect(codes).toContain('stepInputInvalidJson');
    });
  });

  describe('draftBlocker', () => {
    it('returns no_steps for an empty draft', () => {
      expect(draftBlocker(draftState([]))).toBe('no_steps');
    });

    it('returns invalid_steps when issues exist', () => {
      expect(draftBlocker(createDraftState(document([step({ id: '' })])))).toBe('invalid_steps');
    });

    it('returns null for a valid draft', () => {
      expect(draftBlocker(draftState([step()]))).toBeNull();
    });
  });

  it('isDraftValid requires steps and no issues', () => {
    expect(isDraftValid(draftState([]))).toBe(false);
    expect(isDraftValid(draftState([step()]))).toBe(true);
  });

  describe('reducer', () => {
    it('adds steps with unique ids and advances the counter', () => {
      let state = createInitialState();
      state = workflowReducer(state, { type: 'add_step' });
      state = workflowReducer(state, { type: 'add_step' });

      expect(state.draft.definition.steps.map((item) => item.id)).toEqual(['step-0', 'step-1']);
      expect(state.nextStepNumber).toBe(2);
    });

    it('removes a step and its input text', () => {
      let state = createInitialState();
      state = workflowReducer(state, { type: 'add_step' });
      const id = state.draft.definition.steps[0].id;
      state = workflowReducer(state, { type: 'update_step_input_text', stepId: id, text: '{}' });
      state = workflowReducer(state, { type: 'remove_step', stepId: id });

      expect(state.draft.definition.steps).toHaveLength(0);
      expect(state.draft.inputTexts[id]).toBeUndefined();
    });

    it('moves a step up and down', () => {
      let state = createInitialState();
      state = workflowReducer(state, { type: 'add_step' });
      state = workflowReducer(state, { type: 'add_step' });
      state = workflowReducer(state, { type: 'move_step', stepId: 'step-1', direction: 'up' });
      expect(state.draft.definition.steps.map((item) => item.id)).toEqual(['step-1', 'step-0']);

      state = workflowReducer(state, { type: 'move_step', stepId: 'step-1', direction: 'down' });
      expect(state.draft.definition.steps.map((item) => item.id)).toEqual(['step-0', 'step-1']);
    });

    it('renames a step id and migrates its input text', () => {
      let state = createInitialState();
      state = workflowReducer(state, { type: 'add_step' });
      state = workflowReducer(state, {
        type: 'update_step_input_text',
        stepId: 'step-0',
        text: '{"k":1}',
      });
      state = workflowReducer(state, {
        type: 'update_step',
        stepId: 'step-0',
        patch: { id: 'renamed' },
      });

      expect(state.draft.definition.steps[0].id).toBe('renamed');
      expect(state.draft.inputTexts.renamed).toBe('{"k":1}');
      expect(state.draft.inputTexts['step-0']).toBeUndefined();
    });

    it('parses valid input text and reports invalid text as an issue', () => {
      let state = createInitialState();
      state = workflowReducer(state, { type: 'add_step' });
      state = workflowReducer(state, {
        type: 'update_step_input_text',
        stepId: 'step-0',
        text: '{"k":1}',
      });
      expect(state.draft.definition.steps[0].input).toEqual({ k: 1 });

      state = workflowReducer(state, {
        type: 'update_step_input_text',
        stepId: 'step-0',
        text: '{',
      });
      expect(state.draft.issues.map((issue) => issue.code)).toContain('stepInputInvalidJson');
    });

    it('tracks a run through to completion with progress', () => {
      let state = createInitialState();
      state = workflowReducer(state, { type: 'add_step' });
      state = workflowReducer(state, { type: 'add_step' });
      state = workflowReducer(state, { type: 'run_started', runId: 'r1' });
      expect(state.activeRunId).toBe('r1');
      expect(state.runs.r1.state).toBe('queued');

      state = workflowReducer(state, { type: 'step_started', runId: 'r1', stepId: 'step-0' });
      expect(state.runs.r1.state).toBe('running');
      expect(state.runs.r1.activeStepId).toBe('step-0');

      state = workflowReducer(state, {
        type: 'step_succeeded',
        runId: 'r1',
        result: result('step-0', 'succeeded'),
      });
      expect(state.runs.r1.progress).toBeCloseTo(0.5);

      state = workflowReducer(state, {
        type: 'step_succeeded',
        runId: 'r1',
        result: result('step-1', 'succeeded'),
      });
      expect(state.runs.r1.progress).toBe(1);

      state = workflowReducer(state, { type: 'run_completed', runId: 'r1' });
      expect(state.runs.r1.state).toBe('completed');
    });

    it('records a failure with its error and terminal state', () => {
      let state = createInitialState();
      state = workflowReducer(state, { type: 'add_step' });
      state = workflowReducer(state, { type: 'run_started', runId: 'r1' });
      state = workflowReducer(state, {
        type: 'step_failed',
        runId: 'r1',
        result: result('step-0', 'failed'),
      });

      expect(state.runs.r1.state).toBe('failed');
      expect(state.runs.r1.error).toBe('boom');
      expect(state.runs.r1.stepStatus['step-0']).toBe('failed');
    });

    it('selects, clears and resets runs', () => {
      let state = createInitialState();
      state = workflowReducer(state, { type: 'run_started', runId: 'r1' });
      state = workflowReducer(state, { type: 'select_run', runId: null });
      expect(state.activeRunId).toBeNull();

      state = workflowReducer(state, { type: 'clear_history' });
      expect(state.runs).toEqual({});

      state = workflowReducer(state, { type: 'reset' });
      expect(state).toEqual(createInitialState());
    });
  });
});
