import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Ariakit from '@ariakit/react';
import { useQueryClient } from '@tanstack/react-query';
import { Constants } from 'librechat-data-provider';
import { Globe, Loader } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { useRecallQuery } from '~/data-provider/recall';

/**
 * X8 Cross-chat recall: ask across all your conversations. Lexical v1
 * (Meili), scoped to the requesting user server-side; click a hit to open it.
 */
export default function RecallButton() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const enabled = open && submitted.trim().length >= 2;
  const { data, isFetching } = useRecallQuery(submitted, { enabled });
  const popover = Ariakit.usePopoverStore({ placement: 'bottom-end', open, setOpen });

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const openConversation = (conversationId: string) => {
    queryClient.invalidateQueries(['recall']);
    setOpen(false);
    setQ('');
    setSubmitted('');
    navigate(`/c/${conversationId ?? Constants.NEW_CONVO}`);
  };

  const hits = data?.hits ?? [];

  return (
    <>
      <TooltipAnchor
        description={localize('com_ui_recall')}
        render={
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={localize('com_ui_recall')}
            aria-expanded={open}
            className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
          >
            <Globe className="size-4" aria-hidden="true" />
          </button>
        }
      />
      <Ariakit.Popover
        store={popover}
        gutter={8}
        className="z-50 w-[26rem] rounded-xl border border-border-medium bg-surface-primary p-3 shadow-lg"
        aria-label={localize('com_ui_recall')}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(q);
          }}
        >
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder={localize('com_ui_recall_search')}
            aria-label={localize('com_ui_recall_search')}
            className="w-full rounded-lg border border-border-medium bg-surface-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
          />
        </form>
        {isFetching && (
          <p role="status" aria-live="polite" className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
            <Loader className="size-3.5 animate-spin" aria-hidden="true" /> {submitted}
          </p>
        )}
        {!isFetching && submitted.length >= 2 && hits.length === 0 && (
          <p className="mt-3 text-sm text-text-secondary">{localize('com_ui_recall_no_results')}</p>
        )}
        <ul role="list" className="mt-2 space-y-1">
          {hits.map((hit) => (
            <li key={hit.conversationId}>
              <button
                type="button"
                onClick={() => openConversation(hit.conversationId)}
                aria-label={`${localize('com_ui_recall_open')}: ${hit.title}`}
                className="w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
              >
                <span className="block truncate text-sm font-medium text-text-primary">
                  {hit.title}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-xs text-text-secondary">
                  {hit.snippet}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Ariakit.Popover>
    </>
  );
}
