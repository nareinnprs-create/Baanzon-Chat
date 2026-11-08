/**
 * i18n key registry for the Deep Research flow. Every value is a
 * `com_ui_deep_research_*` key in `client/src/locales/en/translation.json`;
 * render them through `useLocalize()` as `localize(DEEP_RESEARCH_LABELS.name)`,
 * passing `{ name: value }` for keys whose copy contains a `{{name}}`
 * placeholder.
 *
 * Keeping the key literals here (rather than inline in each component) lets the
 * unused-i18n-keys check see them, and gives the feature one place to look up
 * the name of a label.
 */
export const DEEP_RESEARCH_LABELS = {
  featureTitle: 'com_ui_deep_research_feature_title',
  featureDescription: 'com_ui_deep_research_feature_description',
  topicLabel: 'com_ui_deep_research_topic_label',
  topicPlaceholder: 'com_ui_deep_research_topic_placeholder',
  generatePlan: 'com_ui_deep_research_generate_plan',
  planning: 'com_ui_deep_research_planning',
  planHeading: 'com_ui_deep_research_plan_heading',
  planDescription: 'com_ui_deep_research_plan_description',
  planTopicLabel: 'com_ui_deep_research_plan_topic_label',
  runPlan: 'com_ui_deep_research_run_plan',
  planEmptyTitle: 'com_ui_deep_research_plan_empty_title',
  planEmptyDescription: 'com_ui_deep_research_plan_empty_description',
  addStep: 'com_ui_deep_research_add_step',
  removeStep: 'com_ui_deep_research_remove_step',
  moveStepUp: 'com_ui_deep_research_move_step_up',
  moveStepDown: 'com_ui_deep_research_move_step_down',
  stepTitleLabel: 'com_ui_deep_research_step_title_label',
  stepTitlePlaceholder: 'com_ui_deep_research_step_title_placeholder',
  stepTitleRequired: 'com_ui_deep_research_step_title_required',
  planInvalid: 'com_ui_deep_research_plan_invalid',
  progressHeading: 'com_ui_deep_research_progress_heading',
  progressSummary: 'com_ui_deep_research_progress_summary',
  stepStatusPending: 'com_ui_deep_research_step_status_pending',
  stepStatusRunning: 'com_ui_deep_research_step_status_running',
  stepStatusPaused: 'com_ui_deep_research_step_status_paused',
  stepStatusCompleted: 'com_ui_deep_research_step_status_completed',
  stepStatusFailed: 'com_ui_deep_research_step_status_failed',
  stepStatusSkipped: 'com_ui_deep_research_step_status_skipped',
  pause: 'com_ui_deep_research_pause',
  resume: 'com_ui_deep_research_resume',
  cancel: 'com_ui_deep_research_cancel',
  runningAnnouncement: 'com_ui_deep_research_running_announcement',
  pausedAnnouncement: 'com_ui_deep_research_paused_announcement',
  completedAnnouncement: 'com_ui_deep_research_completed_announcement',
  cancelledAnnouncement: 'com_ui_deep_research_cancelled_announcement',
  failedAnnouncement: 'com_ui_deep_research_failed_announcement',
  reportHeading: 'com_ui_deep_research_report_heading',
  reportSummary: 'com_ui_deep_research_report_summary',
  reportSources: 'com_ui_deep_research_report_sources',
  reportCitationPlaceholder: 'com_ui_deep_research_report_citation_placeholder',
  reportEmpty: 'com_ui_deep_research_report_empty',
  copyReport: 'com_ui_deep_research_copy_report',
  copiedReport: 'com_ui_deep_research_copied_report',
  retry: 'com_ui_deep_research_retry',
  startOver: 'com_ui_deep_research_start_over',
  failureTitle: 'com_ui_deep_research_failure_title',
  failureDescription: 'com_ui_deep_research_failure_description',
  cancelledTitle: 'com_ui_deep_research_cancelled_title',
  cancelledDescription: 'com_ui_deep_research_cancelled_description',
  noStepsError: 'com_ui_deep_research_no_steps_error',
  noPlanError: 'com_ui_deep_research_no_plan_error',
} as const;

export type DeepResearchLabelKey = keyof typeof DEEP_RESEARCH_LABELS;
