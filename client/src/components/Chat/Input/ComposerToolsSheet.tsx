import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLocalize } from '~/hooks';

interface ComposerToolsSheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Bottom sheet that parks the secondary composer tools on narrow screens, so
 * the input row keeps only attach, model badge, mic and send. Mounted only
 * while open; the same tool components render inline on wide screens.
 */
export default function ComposerToolsSheet({ open, onClose, children }: ComposerToolsSheetProps) {
  const localize = useLocalize();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Move focus into the sheet and hand it back to the trigger on close, so a
  // keyboard user is never stranded behind the backdrop.
  useEffect(() => {
    if (!open) {
      return;
    }
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLButtonElement>('[data-sheet-close]')?.focus();
    return () => previouslyFocused.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={localize('com_ui_composer_tools')}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="relative w-full rounded-t-2xl border-t border-border-light bg-surface-primary p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-text-primary">
            {localize('com_ui_composer_tools')}
          </span>
          <button
            type="button"
            data-sheet-close
            onClick={onClose}
            aria-label={localize('com_ui_close')}
            className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </div>
  );
}
