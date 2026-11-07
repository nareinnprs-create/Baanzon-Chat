import type { TranslationKeys } from '~/hooks';

/** Sections the palette renders. Order here is the render order. */
export type CommandPaletteGroupId = 'actions' | 'navigation' | 'results';

export const COMMAND_PALETTE_GROUPS: CommandPaletteGroupId[] = ['actions', 'navigation', 'results'];

export type CommandPaletteItem = {
  id: string;
  group: CommandPaletteGroupId;
  /** Localized through `useLocalize`; extra search terms are matched alongside it. */
  labelKey: TranslationKeys;
  keywords: string[];
  run: () => void;
};

/** Case-insensitive match against the localized label and the item's keywords. */
export function matchesCommandQuery(label: string, keywords: string[], query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (normalized === '') {
    return true;
  }
  if (label.toLowerCase().includes(normalized)) {
    return true;
  }
  return keywords.some((keyword) => keyword.toLowerCase().includes(normalized));
}
