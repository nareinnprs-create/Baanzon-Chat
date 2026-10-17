import { atom } from 'jotai';
import type { ExportDocument, ExportPdfScope, ExportPdfStatus } from './types';

/**
 * Whether the export dialog is open. The host writes it (⌘/Ctrl+Shift+P, close)
 * and the dialog reads it, so it is feature-owned Jotai state.
 */
export const exportPdfDialogOpenAtom = atom(false);

/** Whole-conversation or a single message. */
export const exportPdfScopeAtom = atom<ExportPdfScope>('conversation');

/** The message chosen when {@link exportPdfScopeAtom} is `message`. */
export const exportPdfSelectedMessageIdAtom = atom<string | null>(null);

/** Lifecycle of the current (or last) print run. */
export const exportPdfStatusAtom = atom<ExportPdfStatus>('idle');

/** Localized failure text for the `error` status. */
export const exportPdfErrorAtom = atom<string | null>(null);

/**
 * The document currently mounted in the print portal. Held here rather than in
 * component state because the portal outlives the dialog: the run closes the
 * dialog's content behind the print layer and clears this when printing ends.
 */
export const exportPdfDocumentAtom = atom<ExportDocument | null>(null);
