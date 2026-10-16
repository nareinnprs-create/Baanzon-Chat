import { useCallback, useRef } from 'react';
import { useAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { Button, EmptyState, IconButton, Skeleton } from '@librechat/client';
import {
  Bell,
  Bot,
  AtSign,
  Share2,
  CalendarClock,
  BookOpen,
  Trash2,
  Check,
  X,
  AlertTriangle,
} from 'lucide-react';
import type { TNotification, TNotificationType } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TranslationKeys } from '~/hooks';
import useNotifications from '~/hooks/useNotifications';
import { notificationsPanelOpenAtom } from './atoms';
import { useFocusTrap, useLocalize } from '~/hooks';
import { cn } from '~/utils';

const PANEL_ID = 'activity-center-panel';

const TYPE_ICONS: Record<TNotificationType, LucideIcon> = {
  system: Bell,
  agent_run: Bot,
  mention: AtSign,
  share: Share2,
  schedule: CalendarClock,
  knowledge: BookOpen,
};

const TYPE_LABEL_KEYS: Record<TNotificationType, TranslationKeys> = {
  system: 'com_ui_notification_type_system',
  agent_run: 'com_ui_notification_type_agent_run',
  mention: 'com_ui_notification_type_mention',
  share: 'com_ui_notification_type_share',
  schedule: 'com_ui_notification_type_schedule',
  knowledge: 'com_ui_notification_type_knowledge',
};

function LoadingState() {
  const localize = useLocalize();
  return (
    <div className="space-y-3 p-3" role="status" aria-live="polite">
      <span className="sr-only">{localize('com_ui_activity_center_loading')}</span>
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const localize = useLocalize();
  return (
    <EmptyState
      icon={AlertTriangle}
      title={localize('com_ui_activity_center_error')}
      action={
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {localize('com_ui_activity_center_retry')}
        </Button>
      }
      className="m-3"
    />
  );
}

interface NotificationRowProps {
  notification: TNotification;
  onOpen: (notification: TNotification) => void;
  onRemove: (id: string) => void;
}

function NotificationRow({ notification, onOpen, onRemove }: NotificationRowProps) {
  const localize = useLocalize();
  const Icon = TYPE_ICONS[notification.type];
  const unread = !notification.read;

  return (
    <li className={cn('flex items-start gap-3 px-3 py-2', unread && 'bg-surface-secondary-alt')}>
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-text-secondary">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen(notification)}
          className="block w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
        >
          <span className="flex items-center gap-1.5">
            {unread && (
              <span
                className="size-2 shrink-0 rounded-full bg-surface-destructive"
                aria-hidden="true"
              />
            )}
            <span className="truncate text-sm font-medium text-text-primary">
              {notification.title}
            </span>
            {unread && <span className="sr-only">{localize('com_ui_notification_unread')}</span>}
          </span>
          {notification.body != null && (
            <span className="mt-0.5 block text-xs text-text-secondary">{notification.body}</span>
          )}
        </button>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-text-tertiary">
            {localize(TYPE_LABEL_KEYS[notification.type])}
          </span>
          <time dateTime={notification.createdAt} className="text-[11px] text-text-tertiary">
            {new Date(notification.createdAt).toLocaleString()}
          </time>
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        {unread && (
          <IconButton
            variant="ghost"
            size="xs"
            shape="round"
            label={localize('com_ui_notification_mark_read')}
            onClick={() => onOpen(notification)}
          >
            <Check className="size-3.5" aria-hidden="true" />
          </IconButton>
        )}
        <IconButton
          variant="ghost"
          size="xs"
          shape="round"
          label={localize('com_ui_notification_delete')}
          onClick={() => onRemove(notification.id)}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </IconButton>
      </div>
    </li>
  );
}

/**
 * Activity Center. Mounted once from `Root.tsx`, so it renders as a floating
 * affordance pinned bottom-right rather than into a header slot the shell does
 * not expose to this feature.
 */
export default function NotificationsBell() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const [open, setOpen] = useAtom(notificationsPanelOpenAtom);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), [setOpen]);
  useFocusTrap(panelRef, open, close);

  const {
    notifications,
    unreadCount,
    isLoading,
    isError,
    isDisabled,
    refetch,
    markRead,
    markAllRead,
    remove,
  } = useNotifications();

  if (isDisabled) {
    return null;
  }

  const badge = unreadCount > 99 ? '99+' : String(unreadCount);
  const triggerLabel =
    unreadCount > 0
      ? localize('com_ui_activity_center_unread', { 0: unreadCount })
      : localize('com_ui_activity_center');

  const handleOpen = (notification: TNotification) => {
    markRead(notification.id);
    if (notification.link) {
      setOpen(false);
      navigate(notification.link);
    }
  };

  let panelContent: ReactNode;
  if (isLoading) {
    panelContent = <LoadingState />;
  } else if (isError) {
    panelContent = <ErrorState onRetry={refetch} />;
  } else if (notifications.length === 0) {
    panelContent = (
      <EmptyState icon={Bell} title={localize('com_ui_activity_center_empty')} className="m-3" />
    );
  } else {
    panelContent = (
      <ul className="divide-y divide-border-light">
        {notifications.map((notification) => (
          <NotificationRow
            key={notification.id}
            notification={notification}
            onOpen={handleOpen}
            onRemove={remove}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40">
      {open && (
        <div
          ref={panelRef}
          id={PANEL_ID}
          role="dialog"
          aria-label={localize('com_ui_activity_center_title')}
          className="absolute bottom-16 right-0 flex max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-light bg-surface-primary shadow-lg"
        >
          <header className="flex items-center justify-between gap-2 border-b border-border-light px-3 py-2">
            <h2 className="text-sm font-semibold text-text-primary">
              {localize('com_ui_activity_center_title')}
            </h2>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => markAllRead()}
                disabled={unreadCount === 0}
              >
                {localize('com_ui_activity_center_mark_all_read')}
              </Button>
              <IconButton
                variant="ghost"
                size="sm"
                shape="round"
                label={localize('com_ui_activity_center_close')}
                onClick={close}
              >
                <X className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">{panelContent}</div>
        </div>
      )}
      <IconButton
        variant="secondary"
        size="lg"
        shape="round"
        className="relative shadow-lg"
        label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={() => setOpen(!open)}
        data-testid="activity-center-trigger"
      >
        <Bell className="size-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            data-testid="activity-center-badge"
            className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-surface-destructive px-1 text-[10px] font-semibold leading-5 text-text-on-status"
            aria-hidden="true"
          >
            {badge}
          </span>
        )}
      </IconButton>
    </div>
  );
}
