/**
 * i18n key registry for the Canvas workspace. Every value is a
 * `com_ui_canvas_*` key in `client/src/locales/en/translation.json`; render
 * them through `useLocalize()` as `localize(CANVAS_LABELS.loading)`, passing
 * `{ index: 1 }` (or the token named in the key's copy) for keys whose text
 * contains a `{{token}}` placeholder.
 *
 * Keeping the key literals here (rather than inline in each component) lets the
 * unused-i18n-keys check see them, and gives the feature one place to look up
 * the name of a label.
 */
export const CANVAS_LABELS = {
  /** The nav link already owns the feature's name; one key, two surfaces. */
  featureTitle: 'com_ui_canvas_title',
  featureDescription: 'com_ui_canvas_description',
  loading: 'com_ui_canvas_loading',
  emptyTitle: 'com_ui_canvas_empty_title',
  emptyDescription: 'com_ui_canvas_empty_description',
  addFirstBlock: 'com_ui_canvas_add_first_block',
  addBlock: 'com_ui_canvas_add_block',
  removeBlock: 'com_ui_canvas_remove_block',
  moveBlockUp: 'com_ui_canvas_move_block_up',
  moveBlockDown: 'com_ui_canvas_move_block_down',
  titleLabel: 'com_ui_canvas_title_label',
  titlePlaceholder: 'com_ui_canvas_title_placeholder',
  blockLabel: 'com_ui_canvas_block_label',
  editorLabel: 'com_ui_canvas_editor_label',
  aiEdit: 'com_ui_canvas_ai_edit',
  aiEditInstructionLabel: 'com_ui_canvas_ai_edit_instruction_label',
  aiEditInstructionPlaceholder: 'com_ui_canvas_ai_edit_instruction_placeholder',
  aiEditApply: 'com_ui_canvas_ai_edit_apply',
  aiEditCancel: 'com_ui_canvas_ai_edit_cancel',
  aiEditBusy: 'com_ui_canvas_ai_edit_busy',
  aiEditSuccess: 'com_ui_canvas_ai_edit_success',
  aiEditFailure: 'com_ui_canvas_ai_edit_failure',
  selectionAnnouncement: 'com_ui_canvas_selection_announcement',
  undo: 'com_ui_canvas_undo',
  redo: 'com_ui_canvas_redo',
  createVersion: 'com_ui_canvas_create_version',
  previewTab: 'com_ui_canvas_preview_tab',
  commentsTab: 'com_ui_canvas_comments_tab',
  versionsTab: 'com_ui_canvas_versions_tab',
  sidePanelLabel: 'com_ui_canvas_side_panel',
  previewHeading: 'com_ui_canvas_preview_heading',
  previewEmpty: 'com_ui_canvas_preview_empty',
  commentsHeading: 'com_ui_canvas_comments_heading',
  commentsEmptyTitle: 'com_ui_canvas_comments_empty_title',
  commentsEmptyDescription: 'com_ui_canvas_comments_empty_description',
  commentComposerLabel: 'com_ui_canvas_comment_composer_label',
  commentComposerPlaceholder: 'com_ui_canvas_comment_composer_placeholder',
  addComment: 'com_ui_canvas_add_comment',
  commentAnchored: 'com_ui_canvas_comment_anchored',
  commentNoAnchor: 'com_ui_canvas_comment_no_anchor',
  resolveComment: 'com_ui_canvas_resolve_comment',
  reopenComment: 'com_ui_canvas_reopen_comment',
  deleteComment: 'com_ui_canvas_delete_comment',
  commentAuthorYou: 'com_ui_canvas_comment_author_you',
  commentResolved: 'com_ui_canvas_comment_resolved',
  commentsUnresolvedCount: 'com_ui_canvas_comments_unresolved_count',
  versionsHeading: 'com_ui_canvas_versions_heading',
  versionsEmptyTitle: 'com_ui_canvas_versions_empty_title',
  versionsEmptyDescription: 'com_ui_canvas_versions_empty_description',
  restoreVersion: 'com_ui_canvas_restore_version',
  deleteVersion: 'com_ui_canvas_delete_version',
  versionCurrent: 'com_ui_canvas_version_current',
  versionCreatedAt: 'com_ui_canvas_version_created_at',
  versionDiffUnchanged: 'com_ui_canvas_version_diff_unchanged',
  versionDiffSummary: 'com_ui_canvas_version_diff_summary',
  commentAdded: 'com_ui_canvas_comment_added',
  versionCreated: 'com_ui_canvas_version_created',
  versionRestored: 'com_ui_canvas_version_restored',
  blockRemoved: 'com_ui_canvas_block_removed',
  failureTitle: 'com_ui_canvas_failure_title',
  failureDescription: 'com_ui_canvas_failure_description',
  retry: 'com_ui_canvas_retry',
  splitResize: 'com_ui_canvas_split_resize',
  leftPane: 'com_ui_canvas_left_pane',
  rightPane: 'com_ui_canvas_right_pane',
} as const;

/** The `com_ui_canvas_*` key strings themselves: what `useLocalize()` takes. */
export type CanvasLabelKey = (typeof CANVAS_LABELS)[keyof typeof CANVAS_LABELS];