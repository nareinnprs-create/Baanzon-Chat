import i18n from '~/locales/i18n';

/**
 * Workflow Builder strings, promoted into `client/src/locales/en/translation.json`
 * under the `com_ui_workflow_*` keys. The map resolves each key through i18next
 * at access time, so components keep the plain `WORKFLOW_LABELS.key` API while
 * every string stays translatable.
 */
const KEYS = {
  featureTitle: 'com_ui_workflow_feature_title',
  featureDescription: 'com_ui_workflow_feature_description',
  editorHeading: 'com_ui_workflow_editor_heading',
  workflowNameLabel: 'com_ui_workflow_name_label',
  workflowNamePlaceholder: 'com_ui_workflow_name_placeholder',
  workflowDescriptionLabel: 'com_ui_workflow_description_label',
  workflowDescriptionPlaceholder: 'com_ui_workflow_description_placeholder',
  nameRequired: 'com_ui_workflow_name_required',
  stepsHeading: 'com_ui_workflow_steps_heading',
  runStepsHeading: 'com_ui_workflow_run_steps_heading',
  addStep: 'com_ui_workflow_add_step',
  removeStep: 'com_ui_workflow_remove_step',
  moveStepUp: 'com_ui_workflow_move_step_up',
  moveStepDown: 'com_ui_workflow_move_step_down',
  stepHeader: 'com_ui_workflow_step_header',
  stepIdLabel: 'com_ui_workflow_step_id_label',
  stepIdPlaceholder: 'com_ui_workflow_step_id_placeholder',
  stepTypeLabel: 'com_ui_workflow_step_type_label',
  stepTypeTransform: 'com_ui_workflow_step_type_transform',
  stepTypeHttp: 'com_ui_workflow_step_type_http',
  stepTypeTool: 'com_ui_workflow_step_type_tool',
  stepTypeBranch: 'com_ui_workflow_step_type_branch',
  stepTypeDelay: 'com_ui_workflow_step_type_delay',
  stepTypeCustom: 'com_ui_workflow_step_type_custom',
  stepNameLabel: 'com_ui_workflow_step_name_label',
  stepNamePlaceholder: 'com_ui_workflow_step_name_placeholder',
  stepInputLabel: 'com_ui_workflow_step_input_label',
  stepInputPlaceholder: 'com_ui_workflow_step_input_placeholder',
  stepNextLabel: 'com_ui_workflow_step_next_label',
  stepNextPlaceholder: 'com_ui_workflow_step_next_placeholder',
  stepTimeoutLabel: 'com_ui_workflow_step_timeout_label',
  stepRetryLabel: 'com_ui_workflow_step_retry_label',
  stepBackoffLabel: 'com_ui_workflow_step_backoff_label',
  stepDelayLabel: 'com_ui_workflow_step_delay_label',
  stepOnTrueLabel: 'com_ui_workflow_step_on_true_label',
  stepOnFalseLabel: 'com_ui_workflow_step_on_false_label',
  stepIdRequired: 'com_ui_workflow_step_id_required',
  stepIdUniqueError: 'com_ui_workflow_step_id_unique_error',
  stepTypeMissingError: 'com_ui_workflow_step_type_missing_error',
  branchNeedsEdgesError: 'com_ui_workflow_branch_needs_edges_error',
  delayNeedsValueError: 'com_ui_workflow_delay_needs_value_error',
  stepInputInvalidJson: 'com_ui_workflow_step_input_invalid_json',
  noStepsTitle: 'com_ui_workflow_no_steps_title',
  noStepsDescription: 'com_ui_workflow_no_steps_description',
  stepsEmptyError: 'com_ui_workflow_steps_empty_error',
  invalidStepsError: 'com_ui_workflow_invalid_steps_error',
  saveWorkflow: 'com_ui_workflow_save',
  savedMessage: 'com_ui_workflow_saved',
  runPanelHeading: 'com_ui_workflow_run_panel_heading',
  runStart: 'com_ui_workflow_run_start',
  runPause: 'com_ui_workflow_run_pause',
  runResume: 'com_ui_workflow_run_resume',
  runCancel: 'com_ui_workflow_run_cancel',
  runInvalid: 'com_ui_workflow_run_invalid',
  runStatusQueued: 'com_ui_workflow_run_status_queued',
  runStatusPending: 'com_ui_workflow_run_status_pending',
  runStatusRunning: 'com_ui_workflow_run_status_running',
  runStatusPaused: 'com_ui_workflow_run_status_paused',
  runStatusCompleted: 'com_ui_workflow_run_status_completed',
  runStatusFailed: 'com_ui_workflow_run_status_failed',
  runStatusSkipped: 'com_ui_workflow_run_status_skipped',
  runStatusCancelled: 'com_ui_workflow_run_status_cancelled',
  progressLabel: 'com_ui_workflow_progress_label',
  progressSummary: 'com_ui_workflow_progress_summary',
  runHistoryHeading: 'com_ui_workflow_run_history_heading',
  historyEmpty: 'com_ui_workflow_history_empty',
  selectRun: 'com_ui_workflow_select_run',
  announceQueued: 'com_ui_workflow_announce_queued',
  announceRunning: 'com_ui_workflow_announce_running',
  announcePaused: 'com_ui_workflow_announce_paused',
  announceCompleted: 'com_ui_workflow_announce_completed',
  announceFailed: 'com_ui_workflow_announce_failed',
  announceCancelled: 'com_ui_workflow_announce_cancelled',
} as const satisfies Record<string, string>;

export type WorkflowLabelKey = keyof typeof KEYS;

export const WORKFLOW_LABELS: Record<WorkflowLabelKey, string> = new Proxy(KEYS, {
  get: (_, key: string) => i18n.t(KEYS[key as WorkflowLabelKey]),
});

/** Replaces i18next `{{name}}` placeholders in a label with the supplied values. */
export function formatLabel(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}
