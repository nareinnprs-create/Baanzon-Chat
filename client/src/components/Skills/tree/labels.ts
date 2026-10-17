/**
 * i18n key registry for the skill tree. Every value is a `com_ui_skill_*` key in
 * `client/src/locales/en/translation.json`; render them through `useLocalize()`
 * as `localize(SKILL_TREE_LABELS.name)`, passing `{ 0: value }` for keys whose
 * copy contains a `{{0}}` placeholder.
 *
 * Keeping the key literals here (rather than inline in each component) lets the
 * unused-i18n-keys check see them, and gives the feature one place to look up
 * the name of a label.
 */
export const SKILL_TREE_LABELS = {
  parentFolder: 'com_ui_skill_parent_folder',
  root: 'com_ui_skill_root',
  moveTitle: 'com_ui_skill_rename_or_move',
  deleteTitle: 'com_ui_skill_delete_file_title',
  deleteConfirm: 'com_ui_skill_delete_file_confirm',
  deleteFolderConfirm: 'com_ui_skill_delete_folder_confirm',
  noFiles: 'com_ui_skill_no_files',
  selectHint: 'com_ui_skill_select_file_hint',
  treeLoadError: 'com_ui_skill_tree_load_error',
  saveFailed: 'com_ui_skill_file_save_error',
  createFailed: 'com_ui_skill_file_create_error',
  renameFailed: 'com_ui_skill_file_rename_error',
  deleteFailed: 'com_ui_skill_file_delete_error',
  created: 'com_ui_skill_file_created',
  renamed: 'com_ui_skill_file_renamed',
  deleted: 'com_ui_skill_file_deleted',
  uploaded: 'com_ui_skill_file_uploaded',
  tooLarge: 'com_ui_skill_file_too_large',
  skillMdReadonly: 'com_ui_skill_md_readonly',
  invalidPath: 'com_ui_skill_invalid_path',
  newFileSubtitle: 'com_ui_skill_new_file_subtitle',
  uploadSubtitle: 'com_ui_skill_upload_subtitle',
} as const;

export type SkillTreeLabelKey = keyof typeof SKILL_TREE_LABELS;
