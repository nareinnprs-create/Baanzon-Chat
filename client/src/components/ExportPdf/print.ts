/**
 * Browser print pipeline for the PDF export. There is no PDF library in the
 * tree by design: the document is handed to the OS print dialog (where the
 * reader picks "Save as PDF"), so this stays dependency-free and PWA-safe.
 */

/** The key for the ⌘/Ctrl+Shift chord that opens the dialog (`p` for PDF). */
export const EXPORT_PDF_SHORTCUT = 'p';

/** Marks `<html>` only for the duration of a print run; the print stylesheet keys off it. */
export const EXPORTING_ROOT_CLASS = 'librechat-exporting';

/** Some engines never fire `afterprint` (or `print()` is a no-op); release the class then. */
const PRINT_FALLBACK_MS = 60_000;

export function isPrintSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.print === 'function';
}

/**
 * Resolve once the print dialog has closed, having scoped the page to the print
 * document for the duration. Rejects if the runtime cannot print.
 */
export function printDocument(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isPrintSupported()) {
      reject(new Error('print-unsupported'));
      return;
    }

    const root = document.documentElement;
    root.classList.add(EXPORTING_ROOT_CLASS);

    let settled = false;
    let fallback = 0;

    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener('afterprint', onAfterPrint);
      window.clearTimeout(fallback);
      root.classList.remove(EXPORTING_ROOT_CLASS);
    };

    const onAfterPrint = () => {
      cleanup();
      resolve();
    };

    window.addEventListener('afterprint', onAfterPrint);
    fallback = window.setTimeout(cleanup, PRINT_FALLBACK_MS);
    /** Keep the timer from holding the process open under Node/SSR-ish runtimes. */
    (fallback as unknown as { unref?: () => void })?.unref?.();

    try {
      window.print();
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error('print-failed'));
    }
  });
}
