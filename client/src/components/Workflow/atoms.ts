import { atom } from 'jotai';
import type { WorkflowAction, WorkflowRunState, WorkflowState } from './state';
import type { WorkflowDraft } from './types';
import {
  createDraftState,
  createInitialState,
  draftBlocker,
  isDraftValid,
  workflowReducer,
} from './state';

/**
 * Feature-owned Jotai state for the Workflow Builder.
 *
 * The editor and the run panel are two halves of one feature: the editor writes
 * the draft, the run panel writes the run, and both read the other's output. So
 * this state lives with the feature rather than in `~/store`, and the reducer in
 * `./state` stays the single source of transitions. Mount the feature under a
 * fresh `<Provider store={createStore()}>` to keep instances isolated.
 */

/** The whole feature state; every derived atom reads from here. */
export const workflowStateAtom = atom<WorkflowState>(createInitialState());

/** The editable document plus its validation issues. */
export const workflowDraftAtom = atom((get) => get(workflowStateAtom).draft);

/** The ordered steps, for rendering the editor and the run report. */
export const workflowStepsAtom = atom((get) => get(workflowStateAtom).draft.definition.steps);

/** Field-level validation issues, in step order. */
export const workflowIssuesAtom = atom((get) => get(workflowStateAtom).draft.issues);

/** Every run, keyed by run id. */
export const workflowRunsAtom = atom((get) => get(workflowStateAtom).runs);

/** Run ids in creation order, newest last. */
export const workflowRunHistoryAtom = atom((get) => get(workflowStateAtom).runHistory);

/** The run currently selected for display, or `null`. */
export const workflowActiveRunAtom = atom<WorkflowRunState | null>((get) => {
  const state = get(workflowStateAtom);
  if (state.activeRunId == null) {
    return null;
  }
  return state.runs[state.activeRunId] ?? null;
});

/** Whether the workflow is named. */
export const workflowNameValidAtom = atom(
  (get) => get(workflowStateAtom).draft.name.trim().length > 0,
);

/** Whether the draft has at least one step and no field issues. */
export const workflowStepsValidAtom = atom((get) => isDraftValid(get(workflowStateAtom).draft));

/** The draft-level error blocking save/run, or `null`. */
export const workflowBlockerAtom = atom((get) => draftBlocker(get(workflowStateAtom).draft));

/** Whether the draft can be saved or run: named, non-empty and issue-free. */
export const workflowReadyAtom = atom(
  (get) => get(workflowNameValidAtom) && get(workflowStepsValidAtom),
);

/** Dispatches one reducer action. Callers may dispatch optimistically. */
export const dispatchWorkflowAtom = atom(null, (get, set, action: WorkflowAction) => {
  set(workflowStateAtom, workflowReducer(get(workflowStateAtom), action));
});

/** Replaces the whole state with a draft built from a host-supplied document. */
export const seedWorkflowAtom = atom(null, (_get, set, input: WorkflowDraft) => {
  set(workflowStateAtom, {
    ...createInitialState(),
    draft: createDraftState(input),
    nextStepNumber: input.definition.steps.length,
  });
});

/** Clears every run and returns the draft to its empty state. */
export const resetWorkflowAtom = atom(null, (_get, set) => {
  set(workflowStateAtom, createInitialState());
});
