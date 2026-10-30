import { useState } from 'react';
import { useParams } from 'react-router-dom';
import * as Ariakit from '@ariakit/react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { ScrollText } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { useRewriteMutation } from '~/data-provider';

/** X7 Session recap: one-shot summarize of the active-branch transcript. */
export default function RecapButton() {
  const localize = useLocalize();
  const { conversationId: routeId } = useParams();
  const queryClient = useQueryClient();
  const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, routeId ?? '']);
  const [open, setOpen] = useState(false);
  const rewrite = useRewriteMutation();
  const popover = Ariakit.usePopoverStore({ placement: 'bottom-end', open, setOpen });

  /** Active-branch transcript, oldest first, capped under the route's 32k. */
  const transcript = (messages ?? [])
    .map((message) => `${message.isCreatedByUser ? 'User' : 'Assistant'}: ${message.text ?? ''}`)
    .join('\n')
    .slice(-30000);

  const disabled = (messages ?? []).length === 0;

  const toggle = () => {
    const next = !open;
    if (next && !rewrite.data && !disabled && !rewrite.isPending) {
      rewrite.mutate({ text: transcript, mode: 'recap' });
    }
    setOpen(next);
  };

  return (
    <>
      <TooltipAnchor
        description={localize('com_ui_recap')}
        render={
          <button
            type="button"
            onClick={toggle}
            disabled={disabled}
            aria-label={localize('com_ui_recap')}
            aria-expanded={open}
            className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary disabled:opacity-40"
          >
            <ScrollText className="size-4" aria-hidden="true" />
          </button>
        }
      />
      <Ariakit.Popover
        store={popover}
        gutter={8}
        className="z-50 max-h-[60vh] w-96 overflow-y-auto rounded-xl border border-border-medium bg-surface-primary p-4 shadow-lg"
        aria-label={localize('com_ui_recap')}
      >
        {rewrite.isPending && (
          <p role="status" aria-live="polite" className="text-sm text-text-secondary">
            {localize('com_ui_recap')}…
          </p>
        )}
        {rewrite.isError && (
          <p role="alert" className="text-sm text-status-destructive">
            {localize('com_ui_error')}
          </p>
        )}
        {rewrite.data && (
          <div className="whitespace-pre-wrap text-sm text-text-primary">{rewrite.data.text}</div>
        )}
      </Ariakit.Popover>
    </>
  );
}
