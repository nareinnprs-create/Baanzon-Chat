import { useCallback, useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useToastContext } from '@librechat/client';
import type { OfflineSendHandler, OfflineSendInput, OfflineSendItem } from '~/utils/offline';
import { offlineOnlineAtom, offlinePendingSendsAtom } from '~/utils/offline/atoms';
import { getOfflineQueue } from '~/utils/offline';
import { NotificationSeverity } from '~/common';
import useLocalize from '~/hooks/useLocalize';

/** One failure notice per item, across every mounted consumer of the queue. */
const notifiedFailures = new Set<string>();

/** Keeps the atom reference stable when nothing changed, so subscribers do not re-render (or
 *  trip act warnings) for the common "still empty" notify. */
const sameQueue = (prev: OfflineSendItem[], next: OfflineSendItem[]): boolean =>
  prev.length === next.length &&
  prev.every(
    (item, index) =>
      item.id === next[index].id &&
      item.status === next[index].status &&
      item.attempts === next[index].attempts &&
      item.error === next[index].error,
  );

/** Tracks `navigator.onLine` in the shared offline atom and re-flushes the queue on reconnect. */
export const useConnectivity = (): boolean => {
  const isOnline = useAtomValue(offlineOnlineAtom);
  const setIsOnline = useSetAtom(offlineOnlineAtom);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const update = (): void =>
      setIsOnline(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [setIsOnline]);

  return isOnline;
};

export type UseOfflineQueueOptions = {
  /** Transport for a queued item; `ask` in the chat composer. Should throw/reject to keep the item. */
  send: OfflineSendHandler;
  /** Scope the drain to this conversation so items cannot land in the wrong chat. */
  conversationId?: string | null;
  /** Show user-facing notices (queued / failed). Defaults to true. */
  notify?: boolean;
};

export type UseOfflineQueueResult = {
  isOnline: boolean;
  pending: OfflineSendItem[];
  pendingCount: number;
  enqueueSend: (input: Omit<OfflineSendInput, 'conversationId'>) => Promise<OfflineSendItem>;
  flush: () => Promise<void>;
};

/**
 * Bridges the app-wide offline queue to React: registers the send handler, mirrors
 * queue state into the feature atoms, and drains on reconnect. Every consumer
 * shares one queue, so concurrent mounts cannot double-send.
 */
export default function useOfflineQueue({
  send,
  conversationId = null,
  notify = true,
}: UseOfflineQueueOptions): UseOfflineQueueResult {
  const queue = getOfflineQueue();
  const { showToast } = useToastContext();
  const localize = useLocalize();
  const isOnline = useConnectivity();
  const pending = useAtomValue(offlinePendingSendsAtom);
  const setPending = useSetAtom(offlinePendingSendsAtom);

  const sendRef = useRef(send);
  sendRef.current = send;
  const registeredHandler = useRef<OfflineSendHandler | null>(null);

  useEffect(() => {
    const handler: OfflineSendHandler = (item) => sendRef.current(item);
    registeredHandler.current = handler;
    queue.setSendHandler(handler);
    return () => {
      if (registeredHandler.current === handler) {
        registeredHandler.current = null;
        queue.setSendHandler(() => false);
      }
    };
  }, [queue]);

  useEffect(() => {
    let active = true;
    const apply = (items: OfflineSendItem[]): void => {
      if (!active) {
        return;
      }
      setPending((prev) => (sameQueue(prev, items) ? prev : items));
      if (!notify) {
        return;
      }
      for (const item of items) {
        if (item.status === 'failed' && !notifiedFailures.has(item.id)) {
          notifiedFailures.add(item.id);
          showToast({
            message: localize('com_ui_offline_send_failed'),
            severity: NotificationSeverity.ERROR,
          });
        }
      }
    };
    const unsubscribe = queue.subscribe(apply);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [queue, setPending, notify, showToast, localize]);

  useEffect(() => {
    if (!isOnline) {
      return;
    }
    void queue.flush({ conversationId });
  }, [isOnline, queue, conversationId]);

  const enqueueSend = useCallback(
    async (input: Omit<OfflineSendInput, 'conversationId'>): Promise<OfflineSendItem> => {
      const item = await queue.enqueue({ ...input, conversationId });
      if (notify) {
        showToast({
          message: localize('com_ui_offline_send_queued'),
          severity: NotificationSeverity.INFO,
        });
      }
      return item;
    },
    [queue, conversationId, notify, showToast, localize],
  );

  const flush = useCallback(async (): Promise<void> => {
    await queue.flush({ conversationId });
  }, [queue, conversationId]);

  return { isOnline, pending, pendingCount: pending.length, enqueueSend, flush };
}
