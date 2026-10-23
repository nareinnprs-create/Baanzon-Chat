/**
 * Workflow Builder — a self-contained editor and run panel for the workflow
 * engine in `packages/api/src/workflows`.
 *
 * The feature owns no transport: every side effect goes through the injected
 * {@link WorkflowExecutor}, whose contract mirrors the backend engine's
 * `WorkflowExecutor`/`WorkflowRunController` pairing. Feature state lives in the
 * Jotai atoms under `./atoms`, pure transitions in `./state`, strings in
 * `./labels`, and the client's mirror of the backend step/definition types in
 * `./types`.
 *
 * ## Mounting
 *
 * ```tsx
 * import { WorkflowView, createInMemoryExecutor } from '~/components/Workflow';
 *
 * export function WorkflowSlot() {
 *   const executor = createInMemoryExecutor();
 *   return <WorkflowView executor={executor} />;
 * }
 * ```
 *
 * `WorkflowView` builds its own Jotai store per instance. To render the editor
 * and run panel separately, mount them under a shared
 * `<Provider store={createStore()}>`.
 */

export { default as WorkflowView } from './WorkflowView';
export { default as WorkflowEditor } from './WorkflowEditor';
export { default as WorkflowRunPanel } from './WorkflowRunPanel';
export { createInMemoryExecutor } from './api';
export { useWorkflowRun } from './run';
export { WORKFLOW_LABELS, formatLabel } from './labels';
export {
  createDraftState,
  draftBlocker,
  isDraftValid,
  createInitialState,
  selectIssuesForStep,
  toWorkflowDraft,
  validateDraft,
  workflowReducer,
} from './state';
export {
  dispatchWorkflowAtom,
  resetWorkflowAtom,
  seedWorkflowAtom,
  workflowActiveRunAtom,
  workflowBlockerAtom,
  workflowDraftAtom,
  workflowIssuesAtom,
  workflowNameValidAtom,
  workflowReadyAtom,
  workflowRunHistoryAtom,
  workflowRunsAtom,
  workflowStateAtom,
  workflowStepsAtom,
  workflowStepsValidAtom,
} from './atoms';
export type { WorkflowEditorProps } from './WorkflowEditor';
export type { WorkflowRunPanelProps, WorkflowRunPanelHandle } from './WorkflowRunPanel';
export type { WorkflowViewProps } from './WorkflowView';
export type { WorkflowRunControls } from './run';
export type {
  WorkflowStepIssue,
  WorkflowDraftState,
  WorkflowRunState as WorkflowRunViewState,
  WorkflowState,
  WorkflowAction,
} from './state';
export type { WorkflowLabelKey } from './labels';
export type {
  InMemoryExecutorOptions,
  WorkflowExecutor,
  WorkflowRunCallbacks,
  WorkflowRunHandle,
} from './api';
export type {
  BranchOutcome,
  StepResult,
  StepRetryPolicy,
  WorkflowDefinition,
  WorkflowDraft,
  WorkflowRunState,
  WorkflowRunSummary,
  WorkflowStartInput,
  WorkflowStep,
  WorkflowStepDisplayStatus,
  WorkflowStepResultStatus,
  WorkflowStepType,
  WorkflowTerminalState,
} from './types';
