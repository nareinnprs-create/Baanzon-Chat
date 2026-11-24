/**
 * Authenticated fetch for the voice endpoints.
 *
 * The access token lives in memory and expires after SESSION_EXPIRY (15 min by
 * default). The app's axios client refreshes transparently, but these calls are
 * plain `fetch` with a token snapshot, so after a quarter of an hour every
 * voice request started returning 401 - Diya could not hear or speak and
 * dictation failed, with no obvious cause.
 *
 * On a 401 this refreshes the session cookie once and retries with the new
 * token. Concurrent callers share the refresh.
 */
let inflightRefresh: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (inflightRefresh != null) {
    return inflightRefresh;
  }
  inflightRefresh = (async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        return null;
      }
      const data = await response.json().catch(() => ({}));
      return typeof data?.token === 'string' && data.token ? data.token : null;
    } catch {
      return null;
    } finally {
      // Clear on the next microtask so concurrent callers share this one.
      setTimeout(() => {
        inflightRefresh = null;
      }, 0);
    }
  })();
  return inflightRefresh;
}

export async function voiceFetch(
  url: string,
  init: RequestInit,
  token?: string | null,
): Promise<Response> {
  const withToken = (value?: string | null): RequestInit => ({
    ...init,
    credentials: 'include',
    headers: {
      ...(init.headers ?? {}),
      ...(value ? { Authorization: `Bearer ${value}` } : {}),
    },
  });

  const first = await fetch(url, withToken(token));
  if (first.status !== 401) {
    return first;
  }
  const refreshed = await refreshAccessToken();
  if (refreshed == null) {
    return first;
  }
  return fetch(url, withToken(refreshed));
}
