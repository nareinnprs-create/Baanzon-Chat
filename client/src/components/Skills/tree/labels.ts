/**
 * Feature-local English labels for skill-tree controls that have no shared
 * `com_ui_*` key yet. Prefer an existing key (`useLocalize`) whenever one
 * exists; these are the gaps.
 *
 * TODO(i18n): promote these into client/src/locales/en/translation.json and
 * replace this map with `useLocalize()` calls.
 */
export const SKILL_TREE_LABELS = {
  parentFolder: 'Parent folder',
  root: 'Root',
  moveTitle: 'Rename or move',
  deleteTitle: 'Delete file',
  deleteConfirm: 'Delete “{0}”? This cannot be undone.',
  deleteFolderConfirm: 'Delete “{0}” and everything inside it? This cannot be undone.',
  noFiles: 'No supporting files yet',
  selectHint: 'Select a file to view or edit it.',
  treeLoadError: 'Failed to load skill files',
  saveFailed: 'Failed to save file',
  createFailed: 'Failed to create file',
  renameFailed: 'Failed to rename file',
  deleteFailed: 'Failed to delete file',
  created: 'File created',
  renamed: 'File renamed',
  deleted: 'File deleted',
  uploaded: 'File uploaded',
  tooLarge: 'File is too large to edit inline',
  skillMdReadonly: 'SKILL.md is edited in the Details tab',
  invalidPath: 'Enter a valid file path',
  newFileSubtitle: 'Create a text file inside this skill.',
  uploadSubtitle: 'Upload a file into this skill.',
} as const;

export type SkillTreeLabelKey = keyof typeof SKILL_TREE_LABELS;

export function formatSkillTreeLabel(
  key: SkillTreeLabelKey,
  values?: Record<string, string>,
): string {
  const template = SKILL_TREE_LABELS[key];
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, token: string) => values[token] ?? match);
}
