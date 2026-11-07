/**
 * Typed IndexedDB wrapper for the offline slice (P5.5).
 *
 * Two object stores back the feature: `drafts` holds the last-known text of a
 * composer draft, and `pendingSends` holds messages a user tried to send while
 * offline. The feature never reaches for `indexedDB` directly: it takes an
 * `OfflineStore`, so the queue logic can be driven by a fake in tests and by an
 * in-memory fallback where IndexedDB is unavailable (private windows, older
 * webviews, jsdom).
 */

export const OFFLINE_DB_NAME = 'baanzon-offline';
export const OFFLINE_DB_VERSION = 1;
export const OFFLINE_DRAFTS_STORE = 'drafts';
export const OFFLINE_PENDING_SENDS_STORE = 'pendingSends';

export type OfflineDraftRecord = {
  /** Composer/draft key the text belongs to (`getComposerDraftId`). */
  id: string;
  conversationId: string | null;
  text: string;
  updatedAt: number;
};

export type OfflinePendingSendStatus = 'pending' | 'sending' | 'failed';

export type OfflinePendingSendRecord = {
  id: string;
  draftId: string;
  conversationId: string | null;
  text: string;
  /** Attachment ids that travel with the message. Upload draining is out of scope for P5.5. */
  files?: string[];
  createdAt: number;
  attempts: number;
  status: OfflinePendingSendStatus;
  error?: string;
};

/** Persistence contract the sync queue depends on. Kept engine-agnostic so callers inject it. */
export interface OfflineStore {
  putDraft(record: OfflineDraftRecord): Promise<void>;
  getDraft(id: string): Promise<OfflineDraftRecord | undefined>;
  listDrafts(): Promise<OfflineDraftRecord[]>;
  deleteDraft(id: string): Promise<void>;
  putPendingSend(record: OfflinePendingSendRecord): Promise<void>;
  getPendingSend(id: string): Promise<OfflinePendingSendRecord | undefined>;
  listPendingSends(): Promise<OfflinePendingSendRecord[]>;
  deletePendingSend(id: string): Promise<void>;
}

const cloneRecord = <T extends object>(record: T): T => JSON.parse(JSON.stringify(record)) as T;

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });

const transactionToPromise = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });

/** Opens (and on first run upgrades) the offline database. Caller owns the connection. */
export const openOfflineDatabase = (factory: IDBFactory): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = factory.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_DRAFTS_STORE)) {
        db.createObjectStore(OFFLINE_DRAFTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(OFFLINE_PENDING_SENDS_STORE)) {
        const store = db.createObjectStore(OFFLINE_PENDING_SENDS_STORE, { keyPath: 'id' });
        store.createIndex('byCreatedAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Unable to open the offline database'));
  });

/** Wraps an already-opened IndexedDB connection in the store contract. */
export const createIndexedDbStore = (db: IDBDatabase): OfflineStore => {
  const read = async <T>(storeName: string, id: string): Promise<T | undefined> => {
    const transaction = db.transaction(storeName, 'readonly');
    const result = await requestToPromise<T | undefined>(
      transaction.objectStore(storeName).get(id) as IDBRequest<T | undefined>,
    );
    await transactionToPromise(transaction).catch(() => undefined);
    return result;
  };

  const getAll = async <T>(storeName: string): Promise<T[]> => {
    const transaction = db.transaction(storeName, 'readonly');
    const result = await requestToPromise<T[]>(
      transaction.objectStore(storeName).getAll() as IDBRequest<T[]>,
    );
    await transactionToPromise(transaction).catch(() => undefined);
    return Array.isArray(result) ? result : [];
  };

  const put = async (storeName: string, record: unknown): Promise<void> => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(record);
    await transactionToPromise(transaction);
  };

  const remove = async (storeName: string, id: string): Promise<void> => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(id);
    await transactionToPromise(transaction);
  };

  return {
    putDraft: (record) => put(OFFLINE_DRAFTS_STORE, cloneRecord(record)),
    getDraft: (id) => read<OfflineDraftRecord>(OFFLINE_DRAFTS_STORE, id),
    listDrafts: () => getAll<OfflineDraftRecord>(OFFLINE_DRAFTS_STORE),
    deleteDraft: (id) => remove(OFFLINE_DRAFTS_STORE, id),
    putPendingSend: (record) => put(OFFLINE_PENDING_SENDS_STORE, cloneRecord(record)),
    getPendingSend: (id) => read<OfflinePendingSendRecord>(OFFLINE_PENDING_SENDS_STORE, id),
    listPendingSends: () => getAll<OfflinePendingSendRecord>(OFFLINE_PENDING_SENDS_STORE),
    deletePendingSend: (id) => remove(OFFLINE_PENDING_SENDS_STORE, id),
  };
};

/** In-memory store with the same contract. Used as the test double and the fallback. */
export const createMemoryStore = (): OfflineStore => {
  const drafts = new Map<string, OfflineDraftRecord>();
  const pendingSends = new Map<string, OfflinePendingSendRecord>();

  return {
    putDraft: async (record) => {
      drafts.set(record.id, cloneRecord(record));
    },
    getDraft: async (id) => {
      const record = drafts.get(id);
      return record == null ? undefined : cloneRecord(record);
    },
    listDrafts: async () => Array.from(drafts.values(), cloneRecord),
    deleteDraft: async (id) => {
      drafts.delete(id);
    },
    putPendingSend: async (record) => {
      pendingSends.set(record.id, cloneRecord(record));
    },
    getPendingSend: async (id) => {
      const record = pendingSends.get(id);
      return record == null ? undefined : cloneRecord(record);
    },
    listPendingSends: async () => Array.from(pendingSends.values(), cloneRecord),
    deletePendingSend: async (id) => {
      pendingSends.delete(id);
    },
  };
};

/** Prefers IndexedDB, degrading to memory when it cannot be opened. */
export const createOfflineStore = (factory?: IDBFactory): OfflineStore => {
  let storePromise: Promise<OfflineStore> | null = null;

  const ensureStore = (): Promise<OfflineStore> => {
    if (storePromise == null) {
      storePromise = (async () => {
        const resolvedFactory = factory ?? (typeof indexedDB === 'undefined' ? null : indexedDB);
        if (resolvedFactory == null) {
          return createMemoryStore();
        }
        try {
          return createIndexedDbStore(await openOfflineDatabase(resolvedFactory));
        } catch (error) {
          console.warn('[offline] IndexedDB unavailable, using in-memory storage.', error);
          return createMemoryStore();
        }
      })();
    }
    return storePromise;
  };

  return {
    putDraft: async (record) => (await ensureStore()).putDraft(record),
    getDraft: async (id) => (await ensureStore()).getDraft(id),
    listDrafts: async () => (await ensureStore()).listDrafts(),
    deleteDraft: async (id) => (await ensureStore()).deleteDraft(id),
    putPendingSend: async (record) => (await ensureStore()).putPendingSend(record),
    getPendingSend: async (id) => (await ensureStore()).getPendingSend(id),
    listPendingSends: async () => (await ensureStore()).listPendingSends(),
    deletePendingSend: async (id) => (await ensureStore()).deletePendingSend(id),
  };
};

let defaultStore: OfflineStore | null = null;

export const getOfflineStore = (): OfflineStore => {
  if (defaultStore == null) {
    defaultStore = createOfflineStore();
  }
  return defaultStore;
};
