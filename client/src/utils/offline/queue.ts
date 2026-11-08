/**
 * Offline sync queue (P5.5).
 *
 * Persists messages a user tried to send while offline and drains them, one at
 * a time and in order, when connectivity returns. The queue is deliberately
 * free of React and of `indexedDB`: it takes an `OfflineStore` and a send
 * handler, so the ordering/retry logic is unit-testable and the app can hand in
 * whichever DB and transport it has.
 *
 * Failure policy: an item the handler rejects stays in the store with
 * `status: 'failed'` and stops the drain, so later messages cannot overtake it
 * inside the same conversation. `flush()` can be called again to retry.
 */

import type {
  OfflinePendingSendRecord,
  OfflinePendingSendStatus,
  OfflineStore,
} from './db';
import { getOfflineStore } from './db';

export type OfflineSendStatus = OfflinePendingSendStatus;

export type OfflineSendItem = {
  id: string;
  draftId: string;
  conversationId: string | null;
  text: string;
  files?: string[];
  createdAt: number;
  attempts: number;
  status: OfflineSendStatus;
  error?: string;
};

export type OfflineSendInput = {
  text: string;
  conversationId?: string | null;
  draftId?: string;
  files?: string[];
};

/** `false` (or a throw) keeps the item queued; anything else counts as sent. */
export type OfflineSendOutcome = boolean | void;

export type OfflineSendHandler = (
  item: OfflineSendItem,
) => OfflineSendOutcome | Promise<OfflineSendOutcome>;

export type OfflineFlushOptions = {
  /** Only drain items queued for this conversation; others stay untouched. */
  conversationId?: string | null;
};

export type OfflineFlushResult = {
  attempted: number;
  sent: string[];
  failed: string[];
  remaining: OfflineSendItem[];
};

export type OfflineQueueOptions = {
  store: OfflineStore;
  send: OfflineSendHandler;
  isOnline?: () => boolean;
  now?: () => number;
  createId?: () => string;
};

export interface OfflineQueue {
  enqueue(input: OfflineSendInput): Promise<OfflineSendItem>;
  list(): Promise<OfflineSendItem[]>;
  flush(options?: OfflineFlushOptions): Promise<OfflineFlushResult>;
  /** Drops queued items belonging to a draft, e.g. once the same text was sent normally. */
  removeForDraft(draftId: string): Promise<number>;
  setSendHandler(handler: OfflineSendHandler): void;
  subscribe(listener: (items: OfflineSendItem[]) => void): () => void;
}

const defaultIsOnline = (): boolean =>
  typeof navigator === 'undefined' || navigator.onLine !== false;

const defaultCreateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // Fall through to a local mint on insecure origins / older webviews.
    }
  }
  return `offline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const toItem = (record: OfflinePendingSendRecord): OfflineSendItem => ({
  ...record,
  ...(record.files != null ? { files: [...record.files] } : {}),
});

const toRecord = (item: OfflineSendItem): OfflinePendingSendRecord => ({
  id: item.id,
  draftId: item.draftId,
  conversationId: item.conversationId,
  text: item.text,
  ...(item.files != null ? { files: [...item.files] } : {}),
  createdAt: item.createdAt,
  attempts: item.attempts,
  status: item.status,
  ...(item.error != null ? { error: item.error } : {}),
});

/** A record left in `sending` means the tab died mid-drain; it is retryable, not in flight. */
const normalizeStatus = (status: OfflinePendingSendStatus): OfflineSendStatus =>
  status === 'sending' ? 'pending' : status;

const orderByCreatedAt = (a: OfflinePendingSendRecord, b: OfflinePendingSendRecord): number =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const createOfflineQueue = ({
  store,
  send,
  isOnline = defaultIsOnline,
  now = Date.now,
  createId = defaultCreateId,
}: OfflineQueueOptions): OfflineQueue => {
  let sendHandler = send;
  const listeners = new Set<(items: OfflineSendItem[]) => void>();
  let drain: Promise<OfflineFlushResult> | null = null;

  const list = async (): Promise<OfflineSendItem[]> => {
    const records = await store.listPendingSends();
    return records
      .slice()
      .sort(orderByCreatedAt)
      .map((record) => toItem({ ...record, status: normalizeStatus(record.status) }));
  };

  const notify = (): void => {
    if (listeners.size === 0) {
      return;
    }
    void list().then((items) => {
      listeners.forEach((listener) => listener(items));
    });
  };

  const matchesScope = (
    item: OfflineSendItem,
    conversationId: string | null | undefined,
  ): boolean => conversationId === undefined || item.conversationId === conversationId;

  const runDrain = async (options?: OfflineFlushOptions): Promise<OfflineFlushResult> => {
    const queued = (await list()).filter((item) => matchesScope(item, options?.conversationId));
    const sent: string[] = [];
    const failed: string[] = [];
    let attempted = 0;

    for (const item of queued) {
      if (isOnline() === false) {
        break;
      }
      attempted += 1;
      const inFlight: OfflineSendItem = {
        ...item,
        attempts: item.attempts + 1,
        status: 'sending',
        error: undefined,
      };
      await store.putPendingSend(toRecord(inFlight));
      notify();

      try {
        const outcome = await sendHandler(inFlight);
        if (outcome === false) {
          throw new Error('Send was not accepted');
        }
        await store.deletePendingSend(item.id);
        sent.push(item.id);
        notify();
      } catch (error) {
        await store.putPendingSend(
          toRecord({ ...inFlight, status: 'failed', error: errorMessage(error) }),
        );
        failed.push(item.id);
        notify();
        /** Stop here: a later message must not be delivered ahead of the failed one. */
        break;
      }
    }

    return { attempted, sent, failed, remaining: await list() };
  };

  return {
    enqueue: async (input) => {
      const conversationId = input.conversationId ?? null;
      const record: OfflinePendingSendRecord = {
        id: createId(),
        draftId: input.draftId ?? conversationId ?? '',
        conversationId,
        text: input.text,
        ...(input.files != null && input.files.length > 0 ? { files: [...input.files] } : {}),
        createdAt: now(),
        attempts: 0,
        status: 'pending',
      };
      await store.putPendingSend(record);
      notify();
      return toItem(record);
    },

    list,

    flush: (options) => {
      if (drain != null) {
        return drain;
      }
      const promise = runDrain(options);
      drain = promise;
      void promise.finally(() => {
        if (drain === promise) {
          drain = null;
        }
      });
      return promise;
    },

    removeForDraft: async (draftId) => {
      const matching = (await list()).filter((item) => item.draftId === draftId);
      for (const item of matching) {
        await store.deletePendingSend(item.id);
      }
      if (matching.length > 0) {
        notify();
      }
      return matching.length;
    },

    setSendHandler: (handler) => {
      sendHandler = handler;
    },

    subscribe: (listener) => {
      listeners.add(listener);
      void list().then((items) => listener(items));
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

let defaultQueue: OfflineQueue | null = null;

/**
 * App-wide singleton. The `send` handler comes from the mounted composer (it
 * needs `ask`), so a placeholder is installed until a consumer registers one;
 * flushing before then simply keeps every item queued.
 */
export const getOfflineQueue = (): OfflineQueue => {
  if (defaultQueue == null) {
    defaultQueue = createOfflineQueue({
      store: getOfflineStore(),
      send: () => false,
    });
  }
  return defaultQueue;
};
