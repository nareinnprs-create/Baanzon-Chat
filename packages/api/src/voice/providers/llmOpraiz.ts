/**
 * Streaming chat-completions client for the Opraiz (Cloudflare) endpoint —
 * the same OpenAI-compatible base text chat already uses. Resolves with the
 * full reply; on abort it resolves with whatever streamed so far so an
 * interrupted turn can still be persisted truncated.
 */
export interface VoiceChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function streamChat(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: VoiceChatMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<string> {
  const base = opts.baseUrl.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: true,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 300,
      }),
      signal: opts.signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) {
      return '';
    }
    throw err;
  }
  if (!res.ok || !res.body) {
    throw new Error(`voice llm request failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  // SSE frames: lines of "data: <json>". Non-JSON payloads (the stream
  // terminator sentinel, comments, blanks) carry no delta and are skipped.
  const absorb = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) {
      return;
    }
    const payload = trimmed.slice(5).trim();
    if (!payload) {
      return;
    }
    let parsed: {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    const delta = parsed.choices?.[0]?.delta?.content;
    if (delta) {
      full += delta;
      opts.onDelta(delta);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      absorb(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  absorb(buf);
  return full;
}
