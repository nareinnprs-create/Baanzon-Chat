import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import { Constants, QueryKeys } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { Label } from '@librechat/client';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks';
import { cn } from '~/utils';
import { aggregateMessageLists } from './aggregate';
import type { UsageAggregate, UsageScope } from './aggregate';
import { usageScopeAtom } from './atoms';

/** Current conversation id from the chat URL (`/c/:conversationId`); the settings
 *  dialog renders over the chat route, so the path always reflects the open chat. */
function currentConversationId(pathname: string): string | null {
  const match = /^\/c\/([^/]+)/.exec(pathname);
  const id = match?.[1];
  return id != null && id !== '' && id !== Constants.NEW_CONVO ? id : null;
}

function StatRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-text-secondary">{label}</dt>
      <dd className="text-sm font-medium text-text-primary">
        {value}
        {hint != null && hint !== '' && (
          <span className="ml-2 text-xs font-normal text-text-tertiary">{hint}</span>
        )}
      </dd>
    </div>
  );
}

function ScopeButton({
  active,
  labelKey,
  onSelect,
}: {
  active: boolean;
  labelKey: TranslationKeys;
  onSelect: () => void;
}) {
  const localize = useLocalize();
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        'rounded-md px-2.5 py-1 text-xs transition-colors motion-reduce:transition-none',
        active
          ? 'bg-surface-hover text-text-primary'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
      )}
    >
      {localize(labelKey)}
    </button>
  );
}

export default function UsageDashboard() {
  const localize = useLocalize();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [scope, setScope] = useAtom(usageScopeAtom);

  const aggregate: UsageAggregate | null = useMemo(() => {
    const cached = queryClient.getQueriesData<TMessage[]>({ queryKey: [QueryKeys.messages] });
    if (scope === 'current') {
      const conversationId = currentConversationId(location.pathname);
      if (conversationId == null) {
        return null;
      }
      const messages = cached.find(([key]) => key[1] === conversationId)?.[1];
      return messages != null && messages.length > 0 ? aggregateMessageLists([messages]) : null;
    }
    return aggregateMessageLists(cached.map(([, messages]) => messages ?? []));
  }, [queryClient, location.pathname, scope]);

  const format = (n: number) => n.toLocaleString();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Label id="usage-dashboard-label">{localize('com_nav_usage_dashboard')}</Label>
        <div
          role="group"
          aria-label={localize('com_nav_usage_dashboard')}
          className="flex items-center gap-1 rounded-lg border border-border-light p-0.5"
        >
          <ScopeButton
            active={scope === 'current'}
            labelKey="com_ui_current"
            onSelect={() => setScope('current')}
          />
          <ScopeButton
            active={scope === 'all'}
            labelKey="com_ui_all_proper"
            onSelect={() => setScope('all')}
          />
        </div>
      </div>
      {aggregate == null || aggregate.messages === 0 ? (
        <p className="rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-secondary">
          {localize('com_ui_usage_no_data')}
        </p>
      ) : (
        <dl className="flex flex-col gap-1.5 rounded-lg border border-border-light bg-surface-primary px-3 py-2">
          <StatRow label={localize('com_ui_usage_messages')} value={format(aggregate.messages)} />
          <StatRow
            label={localize('com_ui_usage_tokens')}
            value={format(aggregate.totalTokens)}
            hint={`${format(aggregate.tokensIn)} / ${format(aggregate.tokensOut)}`}
          />
          <StatRow label={localize('com_ui_usage_cost')} value="—" />
        </dl>
      )}
    </div>
  );
}
