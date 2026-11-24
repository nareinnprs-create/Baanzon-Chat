import { voiceFetch } from '../authFetch';

/**
 * The access token expires after 15 minutes while the session cookie keeps
 * refreshing; before this helper every voice call 401'd silently after that,
 * which looked like "Diya stopped working" with no cause.
 */
describe('voiceFetch', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('passes through a successful response', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ status: 200 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await voiceFetch('/api/voice/tts', { method: 'POST' }, 'tok');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: () => Promise.resolve({ token: 'fresh' }),
      })
      .mockResolvedValueOnce({ status: 200 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await voiceFetch('/api/voice/stt', { method: 'POST' }, 'stale');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh');
    const retryHeaders = fetchMock.mock.calls[2][1].headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe('Bearer fresh');
  });

  it('returns the original 401 when the refresh fails', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValueOnce({ status: 401, ok: false, json: () => Promise.resolve({}) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await voiceFetch('/api/voice/tts', { method: 'POST' }, 'stale');

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
