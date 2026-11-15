import { logger } from '@librechat/data-schemas';

/**
 * Cloudflare Workers AI vision compat shim.
 *
 * CF's universal `/ai/v1/chat/completions` endpoint rejects every OpenAI image
 * part for llama-3.2 vision models with 400 "Unable to add image...", while the
 * native `/ai/run/{model}` endpoint accepts the same OpenAI message shape
 * (system + multi-turn + image_url parts, streaming included) and reads images
 * correctly. When an outgoing request carries an image part and targets a
 * `@cf/` model, rewrite the URL to `/ai/run/{model}` and translate the run
 * response shape back to OpenAI chat completions (streaming and not). All other
 * requests pass through untouched.
 */
export function attachCloudflareVisionRunFetch<T extends object>(
  configOptions: T | undefined | null,
): void {
  if (!configOptions) {
    return;
  }
  const opts = configOptions as Record<string, unknown>;
  const baseURL = typeof opts.baseURL === 'string' ? opts.baseURL : '';
  if (!/\/ai\/v1\/?$/.test(baseURL)) {
    return;
  }
  opts.fetch = cloudflareVisionRunFetch as unknown as typeof opts.fetch;
}

/** Extracts the `@cf/` model id only when the body actually carries an image part. */
function extractVisionModel(requestBody: string): string | null {
  let parsed: { model?: unknown; messages?: unknown };
  try {
    parsed = JSON.parse(requestBody);
  } catch {
    return null;
  }
  const model = typeof parsed?.model === 'string' ? parsed.model : '';
  if (!model.startsWith('@cf/') || !Array.isArray(parsed?.messages)) {
    return null;
  }
  const hasImage = parsed.messages.some(
    (message) =>
      Array.isArray((message as { content?: unknown })?.content) &&
      ((message as { content: unknown[] }).content as unknown[]).some(
        (part) => (part as { type?: unknown })?.type === 'image_url',
      ),
  );
  return hasImage ? model : null;
}

const cloudflareVisionRunFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const requestBody = typeof init?.body === 'string' ? init.body : '';
  const model = requestBody ? extractVisionModel(requestBody) : null;
  if (!model) {
    return fetch(input, init);
  }
  const url = String(input instanceof Request ? input.url : input);
  const runUrl = url.replace(
    /\/ai\/v1\/chat\/completions.*$/,
    `/ai/run/${encodeURIComponent(model)}`,
  );
  if (runUrl === url) {
    return fetch(input, init);
  }
  logger.info(`[cloudflareVision] Routing image request for ${model} to /ai/run`);
  const response = await fetch(runUrl, { ...init, body: requestBody });
  if (!response.ok) {
    return response;
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    return translateRunStream(response, model);
  }
  return translateRunCompletion(response, model);
};

function asResponse(response: Response, body: string): Response {
  return new Response(body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json',
    },
  });
}

async function translateRunCompletion(response: Response, model: string): Promise<Response> {
  const text = await response.text();
  let parsed: { result?: { response?: unknown; usage?: unknown } };
  try {
    parsed = JSON.parse(text);
  } catch {
    return asResponse(response, text);
  }
  const result = parsed?.result;
  if (!result || typeof result.response !== 'string') {
    return asResponse(response, text);
  }
  const completion = {
    id: `cf-run-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: result.response },
        finish_reason: 'stop',
      },
    ],
    ...(result.usage != null ? { usage: result.usage } : {}),
  };
  return new Response(JSON.stringify(completion), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function translateRunStream(response: Response, model: string): Response {
  const id = `cf-run-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  const emit = (controller: TransformStreamDefaultController<Uint8Array>, evt: unknown): void => {
    const response0 = evt as { response?: unknown; usage?: unknown };
    const content = typeof response0?.response === 'string' ? response0.response : '';
    const chunk: Record<string, unknown> = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    };
    const usage = response0?.usage;
    if (
      usage != null &&
      typeof usage === 'object' &&
      (usage as { completion_tokens?: unknown }).completion_tokens != null
    ) {
      chunk.usage = usage;
    }
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  };

  const handleLine = (
    controller: TransformStreamDefaultController<Uint8Array>,
    line: string,
  ): void => {
    if (!line.startsWith('data:')) {
      return;
    }
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') {
      return;
    }
    try {
      emit(controller, JSON.parse(payload));
    } catch {
      // skip malformed SSE line
    }
  };

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        handleLine(controller, buffer.slice(0, nl).trim());
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
    },
    flush(controller) {
      handleLine(controller, buffer.trim());
      // the run endpoint's SSE has no [DONE] terminator; add it
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    },
  });

  return new Response(response.body?.pipeThrough(stream) ?? null, {
    status: response.status,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    },
  });
}
