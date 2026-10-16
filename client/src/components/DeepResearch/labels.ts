/**
 * Feature-local English labels for the Deep Research flow.
 *
 * These are the gaps that have no shared `com_ui_*` key yet; the intent is that
 * every one is promoted into `client/src/locales/en/translation.json` and this
 * map is deleted in favour of `useLocalize()`. The suggested `translation.json`
 * key for each entry is the `i18n` name in the doc comment.
 *
 * TODO(i18n): promote every key below into client/src/locales/en/translation.json
 * and replace this map with `useLocalize()` calls.
 */
export const DEEP_RESEARCH_LABELS = {
  featureTitle: 'Deep Research',
  featureDescription: 'Turn a question into a plan, run it step by step, and read the report.',
  topicLabel: 'Research topic',
  topicPlaceholder: 'What should the research investigate?',
  generatePlan: 'Generate plan',
  planning: 'Building a research plan…',
  planHeading: 'Research plan',
  planDescription: 'Edit the steps, then run the plan. Order matters.',
  planTopicLabel: 'Topic',
  runPlan: 'Run plan',
  planEmptyTitle: 'No steps yet',
  planEmptyDescription: 'Add at least one step to run this research.',
  addStep: 'Add step',
  removeStep: 'Remove step',
  moveStepUp: 'Move step up',
  moveStepDown: 'Move step down',
  stepTitleLabel: 'Step title',
  stepTitlePlaceholder: 'Describe this step',
  stepTitleRequired: 'Every step needs a title before you can run the plan.',
  planInvalid: 'Fix the highlighted steps to run the plan.',
  progressHeading: 'Progress',
  progressSummary: '{completed} of {total} steps complete',
  stepStatusPending: 'Pending',
  stepStatusRunning: 'Running',
  stepStatusPaused: 'Paused',
  stepStatusCompleted: 'Completed',
  stepStatusFailed: 'Failed',
  stepStatusSkipped: 'Skipped',
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancel',
  runningAnnouncement: 'Running step {current} of {total}: {title} ({progress}% complete).',
  pausedAnnouncement: 'Research paused at step {current} of {total}: {title}.',
  completedAnnouncement: 'Research complete. {completed} of {total} steps finished.',
  cancelledAnnouncement: 'Research cancelled.',
  failedAnnouncement: 'Research failed: {reason}',
  reportHeading: 'Report',
  reportSummary: 'Summary',
  reportSources: 'Sources',
  reportCitationPlaceholder: 'No source details available for this citation.',
  reportEmpty: 'The report contains no sections yet.',
  copyReport: 'Copy report',
  copiedReport: 'Copied',
  retry: 'Retry',
  startOver: 'Start over',
  failureTitle: 'Research failed',
  failureDescription: 'The run stopped before it produced a report.',
  cancelledTitle: 'Research cancelled',
  cancelledDescription: 'This run was cancelled. Retry to run the plan again.',
  noStepsError: 'This plan has no steps to run.',
  noPlanError: 'There is no plan to run.',
} as const;

export type DeepResearchLabelKey = keyof typeof DEEP_RESEARCH_LABELS;

/**
 * Interpolates `{token}` placeholders in a label. Kept intentionally small: a
 * drop-in `useLocalize()` accepts the same shape, so migration is mechanical.
 */
export function formatDeepResearchLabel(
  key: DeepResearchLabelKey,
  values?: Record<string, string | number>,
): string {
  const template: string = DEEP_RESEARCH_LABELS[key];
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, token: string) =>
    values[token] === undefined ? match : String(values[token]),
  );
}
