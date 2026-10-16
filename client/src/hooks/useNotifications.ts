import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  TNotification,
  TNotificationsListResponse,
  TNotificationsSettings,
} from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { getResponseStatus } from '~/utils/errors';

/** `/api/notifications` answers 404 on every route when `notifications.enabled` is false. */
const NOTIFICATIONS_DISABLED_STATUS = 404;

/**
 * Settings assumed before the first list response arrives. The server carries
 * the authoritative values in every list/unread-count payload, so these only
 * govern the very first poll.
 */
export const DEFAULT_NOTIFICATIONS_SETTINGS: TNotificationsSettings = {
  enabled: true,
  realtime: true,
  pollingIntervalMs: 60000,
};

export interface UseNotificationsResult {
  notifications: TNotification[];
  unreadCount: number;
  hasMore: boolean;
  settings: TNotificationsSettings;
  isLoading: boolean;
  isError: boolean;
  /** True when the server has the feature switched off (404), so the UI hides itself. */
  isDisabled: boolean;
  refetch: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
}

interface NotificationsCacheContext {
  previous?: TNotificationsListResponse;
}

/**
 * Activity Center data layer.
 *
 * One `[notifications]` query is the source of truth for the list and the unread
 * badge. Realtime delivery prefers a same-origin `EventSource` (the browser
 * replays cookies, so `requireJwtAuth` accepts it) and only while the stream is
 * healthy; otherwise the query polls at `settings.pollingIntervalMs`. Mutations
 * optimistically update the cache and revalidate once the server confirms.
 */
export default function useNotifications(): UseNotificationsResult {
  const { isAuthenticated } = useAuthContext();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => [QueryKeys.notifications], []);
  const [streamActive, setStreamActive] = useState(false);
  const streamActiveRef = useRef(false);
  streamActiveRef.current = streamActive;

  const query = useQuery<TNotificationsListResponse, Error>(
    queryKey,
    () => dataService.listNotifications(),
    {
      enabled: isAuthenticated,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: (failureCount, error) =>
        getResponseStatus(error) !== NOTIFICATIONS_DISABLED_STATUS && failureCount < 2,
      /**
       * Poll only as a fallback: the settings ride on the payload, and the stream
       * (when healthy) is authoritative. A disabled feature never polls — a 404
       * will not clear itself.
       */
      refetchInterval: (data) => {
        const effective = data?.settings ?? DEFAULT_NOTIFICATIONS_SETTINGS;
        if (!effective.enabled) {
          return false;
        }
        if (effective.realtime && streamActiveRef.current) {
          return false;
        }
        return effective.pollingIntervalMs;
      },
    },
  );

  const settings = query.data?.settings ?? DEFAULT_NOTIFICATIONS_SETTINGS;
  const settingsKnown = query.data != null;

  useEffect(() => {
    if (!isAuthenticated || !settingsKnown || !settings.enabled || !settings.realtime) {
      setStreamActive(false);
      return;
    }

    let source: EventSource;
    try {
      source = new EventSource(dataService.notificationStreamUrl());
    } catch {
      setStreamActive(false);
      return;
    }

    const onReady = () => setStreamActive(true);

    const onNotification = (event: MessageEvent) => {
      let payload: { notification?: TNotification; unreadCount?: number };
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      const incoming = payload?.notification;
      if (incoming == null) {
        return;
      }
      queryClient.setQueryData<TNotificationsListResponse>(queryKey, (previous) => {
        if (previous == null) {
          return previous;
        }
        const remaining = previous.notifications.filter((item) => item.id !== incoming.id);
        return {
          ...previous,
          notifications: [incoming, ...remaining],
          unreadCount:
            payload.unreadCount ?? Math.max(0, previous.unreadCount + (incoming.read ? 0 : 1)),
        };
      });
    };

    const onError = () => setStreamActive(false);

    source.addEventListener('ready', onReady);
    source.addEventListener('notification', onNotification as EventListener);
    source.addEventListener('error', onError);

    return () => {
      source.removeEventListener('ready', onReady);
      source.removeEventListener('notification', onNotification as EventListener);
      source.removeEventListener('error', onError);
      source.close();
      setStreamActive(false);
    };
  }, [isAuthenticated, settingsKnown, settings.enabled, settings.realtime, queryClient, queryKey]);

  const markReadMutation = useMutation((id: string) => dataService.markNotificationRead(id), {
    onMutate: async (id: string): Promise<NotificationsCacheContext> => {
      await queryClient.cancelQueries(queryKey);
      const previous = queryClient.getQueryData<TNotificationsListResponse>(queryKey);
      if (previous != null) {
        const target = previous.notifications.find((item) => item.id === id);
        const wasUnread = target != null && !target.read;
        queryClient.setQueryData<TNotificationsListResponse>(queryKey, {
          ...previous,
          notifications: previous.notifications.map((item) =>
            item.id === id ? { ...item, read: true, readAt: new Date().toISOString() } : item,
          ),
          unreadCount: Math.max(0, previous.unreadCount - (wasUnread ? 1 : 0)),
        });
      }
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous != null) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries(queryKey),
  });

  const markAllReadMutation = useMutation(() => dataService.markAllNotificationsRead(), {
    onMutate: async (): Promise<NotificationsCacheContext> => {
      await queryClient.cancelQueries(queryKey);
      const previous = queryClient.getQueryData<TNotificationsListResponse>(queryKey);
      if (previous != null) {
        queryClient.setQueryData<TNotificationsListResponse>(queryKey, {
          ...previous,
          notifications: previous.notifications.map((item) =>
            item.read ? item : { ...item, read: true, readAt: new Date().toISOString() },
          ),
          unreadCount: 0,
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous != null) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries(queryKey),
  });

  const removeMutation = useMutation((id: string) => dataService.deleteNotification(id), {
    onMutate: async (id: string): Promise<NotificationsCacheContext> => {
      await queryClient.cancelQueries(queryKey);
      const previous = queryClient.getQueryData<TNotificationsListResponse>(queryKey);
      if (previous != null) {
        const target = previous.notifications.find((item) => item.id === id);
        const wasUnread = target != null && !target.read;
        queryClient.setQueryData<TNotificationsListResponse>(queryKey, {
          ...previous,
          notifications: previous.notifications.filter((item) => item.id !== id),
          unreadCount: Math.max(0, previous.unreadCount - (wasUnread ? 1 : 0)),
        });
      }
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous != null) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries(queryKey),
  });

  const refetch = useCallback(() => {
    void query.refetch();
  }, [query]);

  return {
    notifications: query.data?.notifications ?? [],
    unreadCount: query.data?.unreadCount ?? 0,
    hasMore: query.data?.hasMore ?? false,
    settings,
    isLoading: query.isLoading,
    isError: query.isError,
    isDisabled:
      settings.enabled === false ||
      getResponseStatus(query.error) === NOTIFICATIONS_DISABLED_STATUS,
    refetch,
    markRead: (id: string) => markReadMutation.mutate(id),
    markAllRead: () => markAllReadMutation.mutate(),
    remove: (id: string) => removeMutation.mutate(id),
  };
}
