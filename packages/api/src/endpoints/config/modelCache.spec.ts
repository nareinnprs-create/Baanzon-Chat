import crypto from 'crypto';
import {
  createModelListCache,
  createCachedModelListFetcher,
  modelListCacheKey,
  DEFAULT_MODEL_LIST_TTL_MS,
} from './modelCache';

describe('createModelListCache', () => {
  it('round-trips set/get (hit) and reports size', async () => {
    const cache = createModelListCache();
    await cache.set('a', ['m1', 'm2']);
    await expect(cache.get('a')).resolves.toEqual(['m1', 'm2']);
    expect(cache.size()).toBe(1);
  });

  it('misses unknown keys', async () => {
    const cache = createModelListCache();
    await expect(cache.get('missing')).resolves.toBeUndefined();
  });

  it('misses and evicts after TTL expiry', async () => {
    let now = 1_000;
    const cache = createModelListCache({ now: () => now, ttlMs: DEFAULT_MODEL_LIST_TTL_MS });
    await cache.set('a', ['m1']);
    await expect(cache.get('a')).resolves.toEqual(['m1']);
    // Just before expiry (2 minutes = 120000ms).
    now += DEFAULT_MODEL_LIST_TTL_MS - 1;
    await expect(cache.get('a')).resolves.toEqual(['m1']);
    // After expiry.
    now += 1;
    await expect(cache.get('a')).resolves.toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('honors a per-entry TTL override', async () => {
    let now = 0;
    const cache = createModelListCache({ now: () => now, ttlMs: 1000 });
    await cache.set('short', ['x'], 10);
    await cache.set('long', ['x']);
    now = 20;
    await expect(cache.get('short')).resolves.toBeUndefined();
    await expect(cache.get('long')).resolves.toEqual(['x']);
  });

  it('does not cache empty results', async () => {
    const cache = createModelListCache();
    await cache.set('empty', []);
    await expect(cache.get('empty')).resolves.toBeUndefined();
  });

  it('evicts the least-recently-used entry at capacity', async () => {
    let now = 0;
    const cache = createModelListCache({ now: () => now, maxEntries: 2 });
    await cache.set('a', ['a']);
    await cache.set('b', ['b']);
    await cache.get('a'); // refresh recency
    await cache.set('c', ['c']); // evicts `b`
    await expect(cache.get('b')).resolves.toBeUndefined();
    await expect(cache.get('a')).resolves.toEqual(['a']);
    await expect(cache.get('c')).resolves.toEqual(['c']);
  });

  it('computes a stable disambiguating key', () => {
    const base = { baseURL: 'https://x/v1', apiKey: 'k', name: 'one' };
    expect(modelListCacheKey(base)).toBe(modelListCacheKey({ ...base }));
    expect(modelListCacheKey(base)).not.toBe(modelListCacheKey({ ...base, apiKey: 'other' }));
    expect(modelListCacheKey(base)).toHaveLength(32);
  });
});

describe('createCachedModelListFetcher', () => {
  it('coalesces concurrent fetches and reuses the result (hit after miss)', async () => {
    let calls = 0;
    const upstream = jest.fn(async () => {
      calls++;
      return ['m1'];
    });
    const fetch = createCachedModelListFetcher(upstream, createModelListCache());
    const [first, second] = await Promise.all([
      fetch({ baseURL: 'u', apiKey: 'k' }),
      fetch({ baseURL: 'u', apiKey: 'k' }),
    ]);
    expect(first).toEqual(['m1']);
    expect(second).toEqual(['m1']);
    expect(calls).toBe(1);

    // Third call within the TTL window is a pure hit.
    await expect(fetch({ baseURL: 'u', apiKey: 'k' })).resolves.toEqual(['m1']);
    expect(calls).toBe(1);
  });

  it('bypasses read and write when skipCache is set', async () => {
    const upstream = jest.fn(async () => ['m1']);
    const fetch = createCachedModelListFetcher(upstream, createModelListCache());
    await expect(fetch({ baseURL: 'u', apiKey: 'k', skipCache: true })).resolves.toEqual(['m1']);
    await expect(fetch({ baseURL: 'u', apiKey: 'k' })).resolves.toEqual(['m1']);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures', async () => {
    const upstream = jest.fn(async () => {
      throw new Error('boom');
    });
    const fetch = createCachedModelListFetcher(upstream, createModelListCache());
    await expect(fetch({ baseURL: 'u', apiKey: 'k' })).rejects.toThrow('boom');
    await expect(fetch({ baseURL: 'u', apiKey: 'k' })).rejects.toThrow('boom');
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});
