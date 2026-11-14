/**
 * The one network call a Diya Orb session makes: POST `/api/diya/turn`.
 *
 * Failures are mapped to a small code vocabulary so the hook can surface a
 * human label without exposing any transport or model detail.
 */

export type DiyaTurnErrorCode = 'unavailable' | 'denied' | 'invalid' | 'upstream';

export class DiyaTurnError extends Error {
  code: DiyaTurnErrorCode;

  constructor(code: DiyaTurnErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'DiyaTurnError';
    this.code = code;
  }
}

/** One prior turn echoed back so replies keep their context. */
export interface DiyaHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

function codeForStatus(status: number): DiyaTurnErrorCode {
  if (status === 503 || status === 404) {
    return 'unavailable';
  }
  if (status === 401 || status === 403) {
    return 'denied';
  }
  if (status >= 400 && status < 500) {
    return 'invalid';
  }
  return 'upstream';
}

/**
 * Sends one user utterance plus the settled history, resolves the reply text.
 * The session token is supplied by the caller (`useAuthContext`).
 */
export async function requestDiyaTurn(
  text: string,
  history: DiyaHistoryTurn[],
  signal: AbortSignal,
  token?: string,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch('/api/diya/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ text, history }),
      signal,
    });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') {
      throw caught;
    }
    throw new DiyaTurnError('upstream');
  }
  if (!response.ok) {
    throw new DiyaTurnError(codeForStatus(response.status));
  }
  let reply: unknown;
  try {
    const data = (await response.json()) as { reply?: unknown };
    reply = data?.reply;
  } catch {
    throw new DiyaTurnError('upstream');
  }
  if (typeof reply !== 'string' || reply.trim() === '') {
    throw new DiyaTurnError('upstream');
  }
  return reply.trim();
}
