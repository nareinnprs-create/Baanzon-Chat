/**
 * Feature-local English labels for the Canvas workspace.
 *
 * These are the gaps that have no shared `com_ui_*` key yet; the intent is that
 * every one is promoted into `client/src/locales/en/translation.json` and this
 * map is deleted in favour of `useLocalize()`. The suggested `translation.json`
 * key for each entry is the `i18n` name in the doc comment.
 *
 * TODO(i18n): promote every key below into client/src/locales/en/translation.json
 * and replace this map with `useLocalize()` calls.
 */
export const CANVAS_LABELS = {
  /** com_ui_canvas_title */
  featureTitle: 'Canvas',
  /** com_ui_canvas_description */
  featureDescription: 'Edit the document, refine a selection with AI, and keep every version.',
  /** com_ui_canvas_loading */
  loading: 'Loading canvas…',
  /** com_ui_canvas_empty_title */
  emptyTitle: 'Nothing on the canvas yet',
  /** com_ui_canvas_empty_description */
  emptyDescription: 'Add a block to start writing, then refine it with AI.',
  /** com_ui_canvas_add_first_block */
  addFirstBlock: 'Add first block',
  /** com_ui_canvas_add_block */
  addBlock: 'Add block',
  /** com_ui_canvas_remove_block */
  removeBlock: 'Remove block {index}',
  /** com_ui_canvas_move_block_up */
  moveBlockUp: 'Move block {index} up',
  /** com_ui_canvas_move_block_down */
  moveBlockDown: 'Move block {index} down',
  /** com_ui_canvas_title_label */
  titleLabel: 'Document title',
  /** com_ui_canvas_title_placeholder */
  titlePlaceholder: 'Untitled document',
  /** com_ui_canvas_block_label */
  blockLabel: 'Block {index}',
  /** com_ui_canvas_editor_label */
  editorLabel: 'Canvas document',
  /** com_ui_canvas_ai_edit */
  aiEdit: 'AI edit',
  /** com_ui_canvas_ai_edit_instruction_label */
  aiEditInstructionLabel: 'Edit instruction',
  /** com_ui_canvas_ai_edit_instruction_placeholder */
  aiEditInstructionPlaceholder: 'e.g. make this shorter',
  /** com_ui_canvas_ai_edit_apply */
  aiEditApply: 'Apply AI edit',
  /** com_ui_canvas_ai_edit_cancel */
  aiEditCancel: 'Cancel',
  /** com_ui_canvas_ai_edit_busy */
  aiEditBusy: 'Applying AI edit…',
  /** com_ui_canvas_ai_edit_success */
  aiEditSuccess: 'AI edit applied.',
  /** com_ui_canvas_ai_edit_failure */
  aiEditFailure: 'The AI edit failed: {reason}',
  /** com_ui_canvas_selection_announcement */
  selectionAnnouncement: '{length} characters selected for AI edit.',
  /** com_ui_canvas_undo */
  undo: 'Undo',
  /** com_ui_canvas_redo */
  redo: 'Redo',
  /** com_ui_canvas_create_version */
  createVersion: 'Save version',
  /** com_ui_canvas_preview_tab */
  previewTab: 'Preview',
  /** com_ui_canvas_comments_tab */
  commentsTab: 'Comments',
  /** com_ui_canvas_versions_tab */
  versionsTab: 'Versions',
  /** com_ui_canvas_side_panel */
  sidePanelLabel: 'Canvas side panel',
  /** com_ui_canvas_preview_heading */
  previewHeading: 'Preview',
  /** com_ui_canvas_preview_empty */
  previewEmpty: 'The document is empty.',
  /** com_ui_canvas_comments_heading */
  commentsHeading: 'Comments',
  /** com_ui_canvas_comments_empty_title */
  commentsEmptyTitle: 'No comments yet',
  /** com_ui_canvas_comments_empty_description */
  commentsEmptyDescription: 'Select text and add a comment to start a review.',
  /** com_ui_canvas_comment_composer_label */
  commentComposerLabel: 'New comment',
  /** com_ui_canvas_comment_composer_placeholder */
  commentComposerPlaceholder: 'Write a comment…',
  /** com_ui_canvas_add_comment */
  addComment: 'Add comment',
  /** com_ui_canvas_comment_anchored */
  commentAnchored: 'On “{quote}”',
  /** com_ui_canvas_comment_no_anchor */
  commentNoAnchor: 'Document-level comment',
  /** com_ui_canvas_resolve_comment */
  resolveComment: 'Resolve comment',
  /** com_ui_canvas_reopen_comment */
  reopenComment: 'Reopen comment',
  /** com_ui_canvas_delete_comment */
  deleteComment: 'Delete comment',
  /** com_ui_canvas_comment_author_you */
  commentAuthorYou: 'You',
  /** com_ui_canvas_comment_resolved */
  commentResolved: 'Resolved',
  /** com_ui_canvas_comments_unresolved_count */
  commentsUnresolvedCount: '{count} unresolved',
  /** com_ui_canvas_versions_heading */
  versionsHeading: 'Versions',
  /** com_ui_canvas_versions_empty_title */
  versionsEmptyTitle: 'No versions yet',
  /** com_ui_canvas_versions_empty_description */
  versionsEmptyDescription: 'Save a version to capture the document as it is now.',
  /** com_ui_canvas_restore_version */
  restoreVersion: 'Restore version',
  /** com_ui_canvas_delete_version */
  deleteVersion: 'Delete version',
  /** com_ui_canvas_version_current */
  versionCurrent: 'Current',
  /** com_ui_canvas_version_created_at */
  versionCreatedAt: 'Saved {at}',
  /** com_ui_canvas_version_diff_unchanged */
  versionDiffUnchanged: 'No changes since this version.',
  /** com_ui_canvas_version_diff_summary */
  versionDiffSummary: '+{added} blocks, -{removed} blocks, ~{changed} changed',
  /** com_ui_canvas_comment_added */
  commentAdded: 'Comment added.',
  /** com_ui_canvas_version_created */
  versionCreated: 'Version saved.',
  /** com_ui_canvas_version_restored */
  versionRestored: 'Version restored.',
  /** com_ui_canvas_block_removed */
  blockRemoved: 'Block removed.',
  /** com_ui_canvas_failure_title */
  failureTitle: 'Could not load the canvas',
  /** com_ui_canvas_failure_description */
  failureDescription: 'The document failed to load.',
  /** com_ui_canvas_retry */
  retry: 'Retry',
  /** com_ui_canvas_split_resize */
  splitResize: 'Resize panes',
  /** com_ui_canvas_left_pane */
  leftPane: 'Document',
  /** com_ui_canvas_right_pane */
  rightPane: 'Assistant',
} as const;

export type CanvasLabelKey = keyof typeof CANVAS_LABELS;

/**
 * Interpolates `{token}` placeholders in a label. Kept intentionally small: a
 * drop-in `useLocalize()` accepts the same shape, so migration is mechanical.
 */
export function formatCanvasLabel(
  key: CanvasLabelKey,
  values?: Record<string, string | number>,
): string {
  const template: string = CANVAS_LABELS[key];
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, token: string) =>
    values[token] === undefined ? match : String(values[token]),
  );
}
