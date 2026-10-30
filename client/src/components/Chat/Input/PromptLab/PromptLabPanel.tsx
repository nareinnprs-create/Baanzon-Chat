import { useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Spinner } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import { promptLabAtom } from './atoms';

interface PromptLabPanelProps {
  /** Writes the rewrite into the composer (host supplies the set-value path). */
  onApply: (text: string) => void;
}

/**
 * Inline rewrite review, floated above the composer (same anchor as the
 * in-flight steer overlay). Apply/discard only — nothing is ever sent.
 */
const PromptLabPanel = ({ onApply }: PromptLabPanelProps) => {
  const localize = useLocalize();
  const state = useAtomValue(promptLabAtom);
  const setPromptLab = useSetAtom(promptLabAtom);
  const open = state != null;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        /** Pre-empt composer/overlay escape handlers: the panel owns Esc while open. */
        e.stopPropagation();
        setPromptLab(null);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, setPromptLab]);

  if (state == null) {
    return null;
  }

  return (
    <div
      data-testid="prompt-lab-panel"
      role="region"
      aria-label={localize('com_ui_prompt_lab')}
      className="absolute inset-x-0 bottom-full z-30 p-2"
    >
      <div className="rounded-xl border border-border-medium bg-surface-primary p-3 shadow-lg">
        <div aria-live="polite" className="min-h-[1.5rem]">
          {state.status === 'loading' && (
            <span className="flex items-center gap-2 text-sm text-text-secondary">
              <Spinner className="size-4" />
              {localize('com_ui_loading')}
            </span>
          )}
          {state.status === 'error' && (
            <span role="alert" className="text-sm text-text-primary">
              {localize('com_ui_error')}
            </span>
          )}
        </div>
        {state.status === 'result' && (
          <>
            <div className="grid gap-3 pt-2 md:grid-cols-2">
              <p
                data-testid="prompt-lab-original"
                className="whitespace-pre-wrap text-sm text-text-tertiary"
              >
                {state.original}
              </p>
              <p
                data-testid="prompt-lab-rewrite"
                className="whitespace-pre-wrap text-sm text-text-primary"
              >
                {state.rewrite}
              </p>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                data-testid="prompt-lab-discard"
                onClick={() => setPromptLab(null)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium text-text-primary transition-colors',
                  'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-xheavy',
                  'motion-reduce:transition-none',
                )}
              >
                {localize('com_ui_prompt_discard')}
              </button>
              <button
                type="button"
                data-testid="prompt-lab-apply"
                onClick={() => {
                  onApply(state.rewrite);
                  setPromptLab(null);
                }}
                className={cn(
                  'rounded-lg bg-text-primary px-3 py-1.5 text-sm font-medium text-surface-primary',
                  'transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-xheavy',
                  'motion-reduce:transition-none',
                )}
              >
                {localize('com_ui_prompt_apply')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PromptLabPanel;
