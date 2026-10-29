/**
 * Short-TTL in-memory cache for upstream `/models` lists.
 *
 * The shared `fetchModels` already carries its own two-minute `MODEL_QUERIES`
 * cache for the hot chat path; this module is the dedicated cache used by
 * admin-side call sites (e.g. the providers "Test" probe) and is exported as
 * a reusable abstraction so a second integration point does not need to
 * re-implement TTL bookkeeping. It is purely in-process (no Redis): entries
 * expire after a short TTL so a provider's model catalog refreshes quickly
 * while repeated probes against the same upstream within the window reuse
 * one upstream round-trip.
 */
import crypto from 'crypto';
import { Time } from 'librechat-data-provider';

export const DEFAULT_MODEL_LIST_TTL_MS = Time.TWO_MINUTES;

export interface ModelListCacheOptions {
  /** Time-to-live for each entry in milliseconds. Defaults to 2 minutes. */
  ttlMs?: number;
  /** Upper bound on cached entries; the least-recently-used entry is evicted. */
  maxEntries?: number;
  /** Overrides `Date.now` for deterministic TTL expiry in tests. */
  now?: () => number;
}

interface CacheEntry {
  value: string[];
  expiresAt: number;
}

export interface ModelListCache {
  get(key: string): Promise<string[] | undefined>;
  set(key: string, value: string[], ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Test/diagnostic hook: number of non-expired entries. */
  size(): number;
}

export function createModelListCache(options: ModelListCacheOptions = {}): ModelListCache {
  const ttlMs = options.ttlMs ?? DEFAULT_MODEL_LIST_TTL_MS;
  const maxEntries = options.maxEntries ?? 64;
  const now = options.now ?? Date.now;
  const entries = new Map<string, CacheEntry>();

  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) {
        return undefined;
      }
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      // Refresh recency for LRU eviction ordering.
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    async set(key, value, entryTtlMs = ttlMs) {
      if (value.length === 0) {
        /** Empty lists usually mean the upstream rejected the request — do
         *  not poison the cache with an auth failure's empty result. */
        return;
      }
      if (entries.size >= maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey !== undefined) {
          entries.delete(oldestKey);
        }
      }
      entries.set(key, { value, expiresAt: now() + entryTtlMs });
    },
    async delete(key) {
      entries.delete(key);
    },
    size() {
      let size = 0;
      for (const entry of entries.values()) {
        if (entry.expiresAt > now()) {
          size++;
        }
      }
      return size;
    },
  };
}

/** Shared singleton used by admin-side call sites. */
export const modelListCache = createModelListCache();

/**
 * Stable cache key for an upstream model-list fetch. Headers are not part of
 * the key: admin-configured header templates are resolved per user, so any
 * fetch that depends on the user object must bypass this cache (callers pass
 * `userObject` and a user key — those probes use `skipCache` semantics in the
 * shared fetch path already).
 */
export function modelListCacheKey({
  baseURL,
  apiKey,
  name,
}: {
  baseURL: string;
  apiKey: string;
  name?: string;
}): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ baseURL, apiKey, name }))
    .digest('hex')
    .slice(0, 32);
}

export interface CachedFetchOptions {
  baseURL: string;
  apiKey: string;
  name?: string;
  /** When true the cache is bypassed for both read and write. */
  skipCache?: boolean;
}

/**
 * Wraps an upstream model-list fetch with the TTL cache and in-flight
 * coalescing, mirroring the read/write semantics `fetchModels` uses for
 * `MODEL_QUERIES` so admin probes and the chat path do not fight each other.
 */
export function createCachedModelListFetcher(
  fetch: (params: CachedFetchOptions) => Promise<string[]>,
  cache: ModelListCache = modelListCache,
): (params: CachedFetchOptions) => Promise<string[]> {
  const inflight = new Map<string, Promise<string[]>>();

  return async function cachedFetch({ skipCache, ...params }) {
    const { baseURL, apiKey, name } = params;
    if (skipCache) {
      return fetch(params);
    }
    const key = modelListCacheKey({ baseURL, apiKey, name });
    const cached = await cache.get(key);
    if (cached) {
      return cached;
    }
    const pending = inflight.get(key);
    if (pending) {
      return pending;
    }
    const promise = (async () => {
      try {
        const models = await fetch(params);
        await cache.set(key, models);
        return models;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, promise);
    return promise;
  };
}
