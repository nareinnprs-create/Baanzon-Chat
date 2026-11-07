import { useMemo } from 'react';
import { useSetAtom } from 'jotai';
import { GitCompare } from 'lucide-react';
import * as Ariakit from '@ariakit/react';
import type { TConversation } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { useRewriteMutation } from '~/data-provider';
import { cn } from '~/utils';
import { promptLabAtom } from './atoms';

interface PromptLabProps {
  conversation: TConversation | null;
  /** Read at click time: the panel reviews the text as it was when clicked. */
  getText: () => string;
}

/**
 * Prompt Lab entry point: sends the composer text to the fork's rewrite route
 * and hands the result to the panel above the composer. Never sends a message.
 */
const PromptLab = ({ conversation, getText }: PromptLabProps) => {
  const localize = useLocalize();
  const setPromptLab = useSetAtom(promptLabAtom);
  const rewrite = useRewriteMutation();
  const label = localize('com_ui_prompt_lab');

  const endpoint = useMemo(() => conversation?.endpoint ?? undefined, [conversation?.endpoint]);
  const model = useMemo(() => conversation?.model ?? undefined, [conversation?.model]);

  const onClick = () => {
    const text = getText();
    if (text.trim().length === 0) {
      return;
    }
    setPromptLab({ status: 'loading', original: text });
    rewrite.mutate(
      { text, mode: 'prompt', endpoint, model },
      {
        onSuccess: (data) =>
          setPromptLab(
            data.text && data.text.length > 0
              ? { status: 'result', original: text, rewrite: data.text }
              : { status: 'error', original: text },
          ),
        onError: () => setPromptLab({ status: 'error', original: text }),
      },
    );
  };

  return (
    <Ariakit.TooltipProvider placement="top" timeout={300}>
      <Ariakit.TooltipAnchor
        render={
          <button
            type="button"
            aria-label={label}
            data-testid="prompt-lab-button"
            onClick={onClick}
            className={cn(
              'flex size-theme-control items-center justify-center rounded-theme-control-round border border-border-light',
              'text-text-secondary transition-colors duration-theme-normal',
              'hover:bg-surface-composer-hover hover:text-text-primary',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-xheavy',
              'animate-in fade-in duration-200 motion-reduce:transition-none motion-reduce:animate-none',
            )}
          >
            <GitCompare className="size-4" aria-hidden="true" />
          </button>
        }
      />
      <Ariakit.Tooltip className="z-50 rounded-lg bg-surface-tertiary px-2 py-1 text-xs text-text-primary shadow-lg">
        {label}
      </Ariakit.Tooltip>
    </Ariakit.TooltipProvider>
  );
};

export default PromptLab;
